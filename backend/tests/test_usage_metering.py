"""FR-18: usage is recorded per call, with the right user and token counts.

The backend owns no user data, so it does not write `model_usage` rows itself —
it reports what a request spent on the `X-PromptMaster-Usage` response header
and the frontend persists it. That split is the architectural invariant in
CLAUDE.md, and it makes the backend's half of the contract exactly this: the
header is present, complete, and correct.

The correctness that matters is the *completeness* one. `generate_json` makes a
second repair call on a parse failure, and every retry attempt is its own paid
request. A meter hung off the routers would count one call and miss both. These
tests pin metering to `_single_request`, which is the only place an HTTP request
to OpenRouter is actually issued.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

import pricing
from main import app
from observability import USAGE_HEADER, UsageAccumulator, UsageEvent, usage_var
from promptmaster.llm_client import _meter


@pytest.fixture(autouse=True)
def clean_pricing():
    pricing.pricing_cache().reset()
    yield
    pricing.pricing_cache().reset()


@pytest.fixture
def accumulator():
    """Stand in for the middleware's per-request accumulator."""
    acc = UsageAccumulator()
    token = usage_var.set(acc)
    yield acc
    usage_var.reset(token)


# ---------------------------------------------------------------------------
# The meter itself
# ---------------------------------------------------------------------------


def test_a_call_is_recorded_with_its_token_counts(accumulator):
    _meter(model="openai/gpt-4o", tokens_in=1200, tokens_out=340, elapsed=1.5, finish_reason="stop")

    assert len(accumulator.events) == 1
    event = accumulator.events[0]
    assert event.model == "openai/gpt-4o"
    assert event.tokens_in == 1200
    assert event.tokens_out == 340
    assert event.elapsed_ms == 1500


def test_every_call_in_a_request_is_counted(accumulator):
    """Four fan-out calls plus a repair pass is five paid requests, not one."""
    for _ in range(5):
        _meter(model="m", tokens_in=100, tokens_out=50, elapsed=0.1, finish_reason="stop")

    assert len(accumulator.events) == 5
    assert accumulator.tokens_in == 500
    assert accumulator.tokens_out == 250


def test_metering_outside_a_request_is_harmless(monkeypatch):
    """No accumulator (a script, a test, a lifespan task) must not raise."""
    token = usage_var.set(None)
    try:
        _meter(model="m", tokens_in=1, tokens_out=1, elapsed=0.1, finish_reason="stop")
    finally:
        usage_var.reset(token)


def test_metering_failure_never_propagates(accumulator, monkeypatch):
    """Bookkeeping must not be able to lose a generation the user paid for."""

    class Exploding:
        def get(self, _model):
            raise RuntimeError("pricing is down")

        def ensure_fresh(self):
            raise RuntimeError("pricing is down")

    monkeypatch.setattr(pricing, "pricing_cache", lambda: Exploding())
    # Must not raise.
    _meter(model="m", tokens_in=10, tokens_out=5, elapsed=0.1, finish_reason="stop")


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


def test_cost_uses_the_price_in_force_at_the_time_of_the_call(accumulator):
    pricing.pricing_cache().prime(
        {"openai/gpt-4o": pricing.ModelPrice(prompt=0.000005, completion=0.000015)}
    )
    _meter(model="openai/gpt-4o", tokens_in=1000, tokens_out=1000, elapsed=1.0, finish_reason="stop")

    event = accumulator.events[0]
    assert event.cost_usd == pytest.approx(0.02)
    # The unit prices are snapshotted onto the row so a later price change does
    # not retroactively rewrite what this call cost.
    assert event.prompt_price_usd == 0.000005
    assert event.completion_price_usd == 0.000015


def test_unknown_pricing_yields_null_cost_not_zero(accumulator):
    """A zero is a lie that looks like a fact."""
    _meter(model="brand/new-model", tokens_in=1000, tokens_out=1000, elapsed=1.0, finish_reason="stop")

    event = accumulator.events[0]
    assert event.cost_usd is None
    assert accumulator.cost_usd is None
    # The tokens are still recorded, so reconciliation is still possible.
    assert event.tokens_in == 1000


def test_suffixed_model_variants_are_priced_as_their_base(accumulator):
    """`:free`, `:nitro` and `:floor` are billed as the base model."""
    pricing.pricing_cache().prime(
        {"meta/llama-3": pricing.ModelPrice(prompt=0.0000001, completion=0.0000002)}
    )
    _meter(model="meta/llama-3:nitro", tokens_in=1000, tokens_out=0, elapsed=1.0, finish_reason="stop")

    assert accumulator.events[0].cost_usd == pytest.approx(0.0001)


def test_mixed_known_and_unknown_pricing_sums_what_it_can(accumulator):
    pricing.pricing_cache().prime({"known": pricing.ModelPrice(prompt=0.001, completion=0.002)})
    _meter(model="known", tokens_in=10, tokens_out=10, elapsed=0.1, finish_reason="stop")
    _meter(model="unknown", tokens_in=10, tokens_out=10, elapsed=0.1, finish_reason="stop")

    assert accumulator.cost_usd == pytest.approx(0.03)
    assert accumulator.tokens_in == 20


# ---------------------------------------------------------------------------
# Price parsing — OpenRouter quotes decimal strings
# ---------------------------------------------------------------------------


def test_prices_parse_from_openrouter_strings():
    parsed = pricing.parse_prices(
        {"data": [{"id": "a/b", "pricing": {"prompt": "0.0000025", "completion": "0.00001"}}]}
    )
    assert parsed["a/b"].prompt == 0.0000025
    assert parsed["a/b"].completion == 0.00001


def test_a_free_model_is_a_real_price_of_zero():
    """`"0"` is falsy as a float and must not be discarded as "unknown"."""
    parsed = pricing.parse_prices(
        {"data": [{"id": "free/model", "pricing": {"prompt": "0", "completion": "0"}}]}
    )
    assert "free/model" in parsed
    assert parsed["free/model"].cost(1_000_000, 1_000_000) == 0.0


def test_unparseable_pricing_is_dropped_rather_than_guessed():
    parsed = pricing.parse_prices(
        {
            "data": [
                {"id": "bad", "pricing": {"prompt": "n/a", "completion": "0.1"}},
                {"id": "missing", "pricing": {}},
                {"id": "nopricing"},
                "not-a-dict",
            ]
        }
    )
    assert parsed == {}


def test_a_malformed_payload_yields_no_prices_rather_than_raising():
    assert pricing.parse_prices(None) == {}
    assert pricing.parse_prices({"data": "nope"}) == {}


# ---------------------------------------------------------------------------
# The header the frontend reads
# ---------------------------------------------------------------------------


def test_a_request_that_spends_nothing_sends_no_usage_header():
    client = TestClient(app)
    res = client.post("/api/estimate-job", json={"section_count": 3, "model": "m"})

    assert res.status_code == 200
    assert USAGE_HEADER not in res.headers


def test_the_usage_header_is_compact_json(accumulator):
    from observability import _annotate
    from starlette.responses import JSONResponse

    accumulator.add(UsageEvent(model="a/b", tokens_in=10, tokens_out=5, elapsed_ms=100, cost_usd=0.5))
    response = JSONResponse({})
    _annotate(response, "req-1", accumulator)

    entries = json.loads(response.headers[USAGE_HEADER])
    assert entries == [{"m": "a/b", "i": 10, "o": 5, "ms": 100, "c": 0.5}]


def test_usage_recorded_inside_a_handler_reaches_the_response_header():
    """The subtle one, and the reason `UsageAccumulator` is mutated not rebound.

    Starlette runs the downstream app in a child task, which copies the context
    at spawn time. A value *set* downstream is invisible to the middleware; an
    object *mutated* downstream is the same object. If anyone ever "tidies"
    `llm_client._meter` into `usage_var.set(...)`, every request would report
    zero usage and nothing else would fail — so this asserts the whole path
    end to end rather than the pieces.
    """
    from deps import get_client

    class MeteringStub:
        """Stands in for the LLM client, recording a call the way the real one does."""

        async def generate_json(self, *_args, **_kwargs):
            _meter(model="a/b", tokens_in=700, tokens_out=250, elapsed=0.4, finish_reason="stop")
            return {"outline": [{"title": "One", "summary": "s"}]}, {}

        async def generate(self, *_args, **_kwargs):
            _meter(model="a/b", tokens_in=700, tokens_out=250, elapsed=0.4, finish_reason="stop")
            return "text", {}

    app.dependency_overrides[get_client] = lambda: MeteringStub()
    try:
        pricing.pricing_cache().prime(
            {"a/b": pricing.ModelPrice(prompt=0.00001, completion=0.00002)}
        )
        res = TestClient(app).post(
            "/api/generate-outline",
            json={
                "inputs": {"objective": "Write a short book.", "mode": "architect"},
                "suggested_section_count": 3,
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)

    assert res.status_code == 200, res.text
    entries = json.loads(res.headers[USAGE_HEADER])
    assert entries[0]["i"] == 700
    assert entries[0]["o"] == 250
    assert entries[0]["c"] == pytest.approx(0.012)


def test_usage_is_reported_even_when_the_request_then_fails():
    """A request can fail *after* spending, and that spend is the important kind.

    A stage generation whose evaluation call 502s has already paid for the
    generation. Dropping its usage because the response was not a 200 would make
    the cost page understate precisely when things are going wrong — which is
    when someone is looking at it.
    """
    from deps import get_client
    from promptmaster.llm_client import OpenRouterError

    class SpendsThenFails:
        async def generate_json(self, *_args, **_kwargs):
            _meter(model="a/b", tokens_in=900, tokens_out=100, elapsed=0.3, finish_reason="stop")
            raise OpenRouterError("HTTP 402", status_code=402)

    app.dependency_overrides[get_client] = lambda: SpendsThenFails()
    try:
        res = TestClient(app).post(
            "/api/generate-outline",
            json={
                "inputs": {"objective": "Write a short book.", "mode": "architect"},
                "suggested_section_count": 3,
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)

    assert res.status_code == 502
    # The credit exhaustion is still classified, not generic.
    assert res.json()["detail"]["code"] == "insufficient_credits"
    # And the tokens it burned before failing are still reported.
    entries = json.loads(res.headers[USAGE_HEADER])
    assert entries[0]["i"] == 900


def test_the_request_id_is_echoed_alongside_the_usage():
    """The client needs both to write a correlated `model_usage` row."""
    from observability import REQUEST_ID_HEADER

    res = TestClient(app).post(
        "/api/estimate-job",
        json={"section_count": 2, "model": "m"},
        headers={REQUEST_ID_HEADER: "corr-123"},
    )
    assert res.headers[REQUEST_ID_HEADER] == "corr-123"


def test_a_very_chatty_request_folds_its_header_by_model():
    """A response header has a practical size ceiling.

    Folding preserves every token and every dollar and loses only the per-call
    breakdown, which is the right thing to give up.
    """
    from observability import _annotate
    from starlette.responses import JSONResponse

    acc = UsageAccumulator()
    for _ in range(30):
        acc.add(UsageEvent(model="a/b", tokens_in=10, tokens_out=5, elapsed_ms=10, cost_usd=0.01))

    response = JSONResponse({})
    _annotate(response, "req-1", acc)
    entries = json.loads(response.headers[USAGE_HEADER])

    assert len(entries) == 1
    assert entries[0]["i"] == 300
    assert entries[0]["o"] == 150
    assert entries[0]["c"] == pytest.approx(0.3)
