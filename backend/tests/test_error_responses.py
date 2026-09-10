"""FR-16 at the HTTP boundary: the taxonomy reaches the client.

`test_error_taxonomy.py` proves the classifier maps failures onto codes. This
file proves the API *uses* it — which for a long time it did not. Until the
`routers/_errors.py` helper landed, every synchronous endpoint answered a
provider failure with the string ``LLM error: <repr>``, so nine carefully
written recovery messages were reachable only from the job drain and a user who
ran out of credit on a stage saw an HTTP status code.

The property every test here is really checking is the one FR-16 exists for:
**a classified failure always states what was preserved.** A message that says
"out of credits" and nothing else leaves a user with six drafted sections
unable to tell whether they still have them, and the rational response to that
is to redo work they already paid for.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster import errors
from promptmaster.llm_client import OpenRouterDeadlineError, OpenRouterError

INPUTS = {
    "objective": "A field guide to governing AI-assisted work.",
    "audience": "Engineering leads",
    "mode": "architect",
}

STAGE_BODY = {
    "inputs": INPUTS,
    "stage": {"id": "positioning", "renderer": "prose"},
}


@pytest.fixture
def client_with():
    def _install(stub):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app, raise_server_exceptions=False)

    yield _install
    app.dependency_overrides.pop(get_client, None)


def _fail_stage(client_with, error: BaseException):
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(side_effect=error)
    client = client_with(stub)
    r = client.post("/api/generate-stage-artifact", json=STAGE_BODY)
    return r


# ---------------------------------------------------------------------------
# The shape of a failure
# ---------------------------------------------------------------------------

def test_detail_is_an_object_carrying_a_code(client_with):
    r = _fail_stage(client_with, OpenRouterError("HTTP 402", status_code=402))
    assert r.status_code == 502

    detail = r.json()["detail"]
    assert detail["code"] == errors.INSUFFICIENT_CREDITS
    assert detail["title"] == "Out of model credits"
    assert detail["retryable"] is False
    assert detail["provider_status"] == 402


def test_the_legacy_string_is_still_there(client_with):
    """Nothing regresses for a client that reads `detail` as text.

    The old contract was a bare ``LLM error: ...`` string. It is now nested one
    level down, unchanged, which is also what fills the "view technical
    details" disclosure — the FR-16 action that needs something raw to show.
    """
    r = _fail_stage(client_with, OpenRouterError("upstream down"))
    assert r.json()["detail"]["detail"] == "LLM error: upstream down"


def test_status_stays_502_whatever_the_provider_said(client_with):
    """This server did not run out of credit; its upstream did.

    Passing 402 or 429 through would also collide with the client's
    401-refresh path and with every existing test that keys off 502.
    """
    for error in (
        OpenRouterError("HTTP 402", status_code=402),
        OpenRouterError("slow down", status_code=429, retry_after=30.0),
        OpenRouterError("boom", status_code=503),
    ):
        assert _fail_stage(client_with, error).status_code == 502


def test_retry_after_survives_the_hop(client_with):
    r = _fail_stage(client_with, OpenRouterError("slow down", status_code=429, retry_after=30.0))
    detail = r.json()["detail"]
    assert detail["code"] == errors.RATE_LIMITED
    assert detail["retry_after"] == 30.0
    assert "30s" in detail["message"]


# ---------------------------------------------------------------------------
# The rule: every message says what was preserved
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "error, expected_code",
    [
        (OpenRouterError("HTTP 402", status_code=402), errors.INSUFFICIENT_CREDITS),
        (OpenRouterError("slow down", status_code=429), errors.RATE_LIMITED),
        (
            OpenRouterError("too long", status_code=400, provider_code="context_length_exceeded"),
            errors.CONTEXT_LENGTH,
        ),
        (OpenRouterError("boom", status_code=503), errors.PROVIDER_UNAVAILABLE),
        (OpenRouterError("no", status_code=400), errors.INVALID_REQUEST),
        (OpenRouterDeadlineError("out of time"), errors.FUNCTION_TIMEOUT),
        (OpenRouterError("something odd"), errors.UNKNOWN),
    ],
)
def test_every_classified_failure_states_what_was_preserved(client_with, error, expected_code):
    detail = _fail_stage(client_with, error).json()["detail"]
    assert detail["code"] == expected_code
    assert "Nothing was lost" in detail["message"]
    assert errors.PRESERVED_STAGE_VERSIONS in detail["message"]


def test_evaluating_says_it_never_rewrites(client_with):
    """Scoring a stage cannot lose the thing it scored, and now says so.

    Evaluation degrades rather than 502s — that decision predates this work and
    is right: an evaluation the user paid for should not take the stage down
    with it. What was wrong was the copy. The three dimension explanations read
    ``Evaluation error: OpenRouter API error: HTTP 402``, printed three times,
    which is the raw-provider-error experience FR-18 also rules out as a
    default. The raw cause is still there, at the end, where a person who wants
    it can find it.
    """
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=OpenRouterError("HTTP 402", status_code=402))
    client = client_with(stub)

    r = client.post(
        "/api/evaluate-stage-artifact",
        json={**STAGE_BODY, "content": "Some drafted positioning."},
    )
    assert r.status_code == 200

    explanation = r.json()["evaluation"]["alignment"]["explanation"]
    assert explanation.startswith("The OpenRouter account has run out of credit")
    assert "Nothing was lost" in explanation
    assert "never rewrites your work" in explanation
    assert "(Technical detail: HTTP 402)" in explanation


def test_a_failed_section_names_the_sections_already_written(client_with):
    """The canonical FR-16 example, end to end.

    A book six sections in must not report a billing failure as though the six
    were gone. `section_index` is how many are already saved, and the message
    is required to say so in those words.
    """
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(side_effect=OpenRouterError("HTTP 402", status_code=402))
    client = client_with(stub)

    r = client.post(
        "/api/generate-section-prose",
        json={
            "inputs": INPUTS,
            "outline": [
                {"id": f"s{i}", "title": f"Section {i}", "abstract": ""} for i in range(10)
            ],
            "section_index": 6,
        },
    )
    assert r.status_code == 502
    assert "Nothing was lost — 6 of 10 sections are saved." in r.json()["detail"]["message"]


def test_the_first_section_claims_nothing_it_cannot_show(client_with):
    """"0 of 10 sections are saved" is noise; the general clause is used instead."""
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(side_effect=OpenRouterError("HTTP 402", status_code=402))
    client = client_with(stub)

    r = client.post(
        "/api/generate-section-prose",
        json={
            "inputs": INPUTS,
            "outline": [{"id": "s0", "title": "Opening", "abstract": ""}],
            "section_index": 0,
        },
    )
    message = r.json()["detail"]["message"]
    assert "0 of" not in message
    assert errors.PRESERVED_NOTHING_WRITTEN in message


def test_outlining_is_wired_too(client_with):
    """FR-16 is not a drafting-stage feature; every synchronous path is covered.

    Outlining is the one worth pinning: it is the second most expensive thing a
    user does, and until now it answered a rate limit with the word "429".
    """
    stub = AsyncMock()
    stub.generate_json = AsyncMock(
        side_effect=OpenRouterError("slow down", status_code=429, retry_after=12.0)
    )
    client = client_with(stub)

    r = client.post("/api/generate-outline", json={"inputs": INPUTS})
    assert r.status_code == 502

    detail = r.json()["detail"]
    assert detail["code"] == errors.RATE_LIMITED
    assert detail["retryable"] is True
    assert "Nothing was lost" in detail["message"]
    assert errors.PRESERVED_NOTHING_WRITTEN in detail["message"]
