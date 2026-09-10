"""FR-18: generation-size caps, rejected at the schema edge.

Two properties, and the second is as important as the first.

**Rejected at the edge.** An over-size request must be refused by validation
before the handler runs, so it costs one 422 and zero LLM calls. The tests
assert the LLM client was never touched, not merely that the status was 4xx — a
router that generated first and validated after would pass a status-only test
while burning the money the cap exists to protect.

**With a usable message.** FastAPI's default 422 body is a list of `{loc, msg,
type}` objects, which `lib/api/client.ts` cannot read and renders as
`API error: 422`. The user who asked for 500 sections would be told nothing.
`validation.py` reshapes it into the FR-16 detail object, and these tests hold
that shape in place.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.limits import (
    MAX_OBJECTIVE_CHARS,
    MAX_SECTION_COUNT,
    MAX_SESSION_FACT_CHARS,
    MAX_SESSION_FACTS,
)


@pytest.fixture
def never_called_client():
    """An LLM client that fails the test if anything calls it."""
    client = AsyncMock()

    async def _explode(*_args, **_kwargs):
        raise AssertionError("An over-size request reached the model.")

    client.generate = AsyncMock(side_effect=_explode)
    client.generate_json = AsyncMock(side_effect=_explode)
    client.generate_with_meta = AsyncMock(side_effect=_explode)

    app.dependency_overrides[get_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_client, None)


@pytest.fixture
def client(never_called_client) -> TestClient:
    return TestClient(app)


def inputs(**overrides) -> dict:
    base = {
        "objective": "Write a short book about tidal energy.",
        "audience": "General",
        "constraints": "",
        "output_format": "",
        "mode": "architect",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# The field this module was written for
# ---------------------------------------------------------------------------


def test_five_hundred_sections_is_refused(client):
    """The bug: `suggested_section_count: int = 8` had no upper bound.

    500 sections is ~1000 paid LLM calls, drained one at a time until the
    account is empty, and it was a well-formed request.
    """
    res = client.post(
        "/api/generate-outline",
        json={"inputs": inputs(), "suggested_section_count": 500},
    )
    assert res.status_code == 422


def test_zero_sections_is_refused(client):
    res = client.post(
        "/api/generate-outline",
        json={"inputs": inputs(), "suggested_section_count": 0},
    )
    assert res.status_code == 422


def test_the_maximum_itself_is_allowed(client, never_called_client):
    """A cap that trips one below its stated limit is a bug, not a control."""
    never_called_client.generate_json = AsyncMock(
        return_value=({"sections": [], "title": "T"}, {})
    )
    res = client.post(
        "/api/generate-outline",
        json={"inputs": inputs(), "suggested_section_count": MAX_SECTION_COUNT},
    )
    assert res.status_code != 422


def test_the_refusal_names_the_field_and_the_limit(client):
    """"String should have at most 40 characters" is not a usable message."""
    res = client.post(
        "/api/generate-outline",
        json={"inputs": inputs(), "suggested_section_count": 500},
    )
    detail = res.json()["detail"]

    assert detail["code"] == "invalid_request"
    assert "number of sections" in detail["message"]
    assert str(MAX_SECTION_COUNT) in detail["message"]
    # FR-16: say what was preserved, and say nothing was charged.
    assert "nothing was charged" in detail["message"].lower()
    assert detail["retryable"] is False


def test_the_refusal_keeps_the_raw_errors_for_the_details_disclosure(client):
    res = client.post(
        "/api/generate-outline",
        json={"inputs": inputs(), "suggested_section_count": 500},
    )
    assert "suggested_section_count" in res.json()["detail"]["detail"]


# ---------------------------------------------------------------------------
# The other unbounded inputs
# ---------------------------------------------------------------------------


def test_an_enormous_objective_is_refused(client):
    res = client.post(
        "/api/generate-outline",
        json={
            "inputs": inputs(objective="x" * (MAX_OBJECTIVE_CHARS + 1)),
            "suggested_section_count": 4,
        },
    )
    assert res.status_code == 422
    assert "objective" in res.json()["detail"]["message"]


def test_too_many_session_facts_are_refused(client):
    """Facts are injected into *every* prompt, so their cost is multiplied."""
    res = client.post(
        "/api/generate-outline",
        json={
            "inputs": inputs(session_facts=["a fact"] * (MAX_SESSION_FACTS + 1)),
            "suggested_section_count": 4,
        },
    )
    assert res.status_code == 422
    assert "session facts" in res.json()["detail"]["message"]


def test_one_enormous_session_fact_is_refused(client):
    """Fifty facts of unbounded size is the same unbounded prompt as one.

    Pydantic's `max_length` on `list[str]` bounds the list, not its elements,
    so this is the case a list bound alone would let through.
    """
    res = client.post(
        "/api/generate-outline",
        json={
            "inputs": inputs(session_facts=["x" * (MAX_SESSION_FACT_CHARS + 1)]),
            "suggested_section_count": 4,
        },
    )
    assert res.status_code == 422
    message = res.json()["detail"]["message"]
    # Our own validator writes the sentence, so it survives verbatim.
    assert "session fact" in message.lower()
    assert "every prompt" in message


def test_an_enormous_section_body_is_refused(client):
    res = client.post(
        "/api/extract-section-record",
        json={
            "section_id": "s1",
            "section_index": 0,
            "section_content": "x" * 500_000,
        },
    )
    assert res.status_code == 422


def test_a_negative_section_index_is_refused(client):
    res = client.post(
        "/api/extract-section-record",
        json={"section_id": "s1", "section_index": -1, "section_content": "hi"},
    )
    assert res.status_code == 422


def test_multiple_violations_are_all_reported(client):
    """One round-trip per mistake is a bad way to fix three mistakes."""
    res = client.post(
        "/api/generate-outline",
        json={
            "inputs": inputs(objective="x" * (MAX_OBJECTIVE_CHARS + 1)),
            "suggested_section_count": 900,
        },
    )
    message = res.json()["detail"]["message"]
    assert "objective" in message
    assert "number of sections" in message
