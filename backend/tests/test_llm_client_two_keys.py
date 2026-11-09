"""Two OpenRouter keys: whichever can pay does the work.

The refusals below are OpenRouter's own: the two 402s are the wording recorded
on production, and every real credit refusal so far has been one of them. Both
arrive while a little money is left, before any model runs. The 403 shapes are
from OpenRouter's errors page, which gives a key's own spending limit as 402 in
one place and 403 in another.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from unittest.mock import AsyncMock

import httpx
import pytest

import deps
from observability import UsageAccumulator, usage_var
from promptmaster import llm_client
from promptmaster.errors import INSUFFICIENT_CREDITS, classify_error
from promptmaster.llm_client import OpenRouterClient, OpenRouterError

FIRST = "first-key-value"
SECOND = "second-key-value"

OK = (200, {"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 2}})
IN_FLIGHT = (402, {"error": {"code": 402, "message": "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.", "metadata": {"reason": "in_flight_budget_exhausted", "limit_source": "openrouter_in_flight_budget"}}})
TOO_DEAR = (402, {"error": {"code": 402, "message": "This request's maximum cost exceeds your available credits. Add credits, or lower max_tokens or prompt size.", "metadata": {"reason": "weight_exceeds_budget", "limit_source": "openrouter_credits"}}})
BARE_402 = (402, {"error": {"code": 402, "message": "Insufficient credits"}})
KEY_LIMIT = (403, {"error": {"code": 403, "message": "Key limit exceeded", "metadata": {"limit_source": "openrouter_key_limit", "scope": "key_limit", "limit_usd": 5, "spend_usd": 5.01}}})
MODERATED = (403, {"error": {"code": 403, "message": "Your input was flagged", "metadata": {"reasons": ["harassment"], "flagged_input": "text", "provider_name": "x", "model_slug": "y"}}})
BAD_KEY = (401, {"error": {"code": 401, "message": "User not found."}})
BAD_REQUEST = (400, {"error": {"code": 400, "message": "Provider returned error"}})
RATE_LIMITED = (429, {"error": {"code": 429, "message": "Rate limited"}})
SERVER_ERROR = (500, {"error": {"code": 500, "message": "Internal error"}})


class Provider:
    """Stands in for OpenRouter: what each key is answered, and who asked."""

    def __init__(self, first, second=OK):
        self.answers = {FIRST: first, SECOND: second}
        self.keys: list[str] = []
        self.bodies: list[dict] = []
        self.auth_headers: list[list[str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.auth_headers.append(request.headers.get_list("authorization"))
        key = request.headers["authorization"].removeprefix("Bearer ")
        self.keys.append(key)
        self.bodies.append(json.loads(request.content))
        status, body = self.answers[key]
        return httpx.Response(status, json=body)


def _client(provider: Provider, second_key: str | None = SECOND) -> OpenRouterClient:
    client = OpenRouterClient(api_key=FIRST, second_key=second_key)
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(provider))
    return client


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    """A retry's backoff is recorded, never slept through."""
    sleep = AsyncMock()
    monkeypatch.setattr(llm_client.asyncio, "sleep", sleep)
    return sleep


def _rest_is_over(client: OpenRouterClient, key: str) -> None:
    client._no_credit_until[key] = time.monotonic() - 1


async def test_the_first_key_does_the_work_while_it_has_credit():
    provider = Provider(OK)
    content, _ = await _client(provider).generate("p")
    assert content == '{"ok": true}'
    assert provider.keys == [FIRST]
    assert provider.auth_headers == [[f"Bearer {FIRST}"]]


@pytest.mark.parametrize("refusal", [IN_FLIGHT, TOO_DEAR, BARE_402], ids=["in_flight", "too_dear", "bare"])
async def test_a_key_refused_for_credit_hands_the_same_request_to_the_other(refusal, no_waiting):
    provider = Provider(refusal)
    usage = UsageAccumulator()
    token = usage_var.set(usage)
    try:
        content, _ = await _client(provider).generate("p")
    finally:
        usage_var.reset(token)

    assert content == '{"ok": true}'
    assert provider.keys == [FIRST, SECOND]
    assert provider.bodies[0] == provider.bodies[1]
    no_waiting.assert_not_awaited()
    assert [e.attempt for e in usage.events] == ["first"], "moving to the other key is not a retry"


@pytest.mark.parametrize(
    "call",
    [
        lambda c: c.generate("p"),
        lambda c: c.generate_with_meta("p"),
        lambda c: c.generate_json("p"),
        lambda c: c.generate_with_web("p"),
    ],
    ids=["generate", "generate_with_meta", "generate_json", "generate_with_web"],
)
async def test_every_kind_of_call_can_move_to_the_other_key(call):
    provider = Provider(IN_FLIGHT)
    await call(_client(provider))
    assert provider.keys == [FIRST, SECOND]


async def test_the_next_call_goes_straight_to_the_key_that_can_pay():
    provider = Provider(IN_FLIGHT)
    client = _client(provider)
    await client.generate("p")
    await client.generate("p")
    assert provider.keys == [FIRST, SECOND, SECOND]


async def test_a_refused_key_rests_five_minutes_then_is_asked_first_again():
    provider = Provider(IN_FLIGHT)
    client = _client(provider)
    await client.generate("p")
    assert client._no_credit_until[FIRST] - time.monotonic() == pytest.approx(300, abs=5)

    provider.answers[FIRST] = OK  # topped up
    _rest_is_over(client, FIRST)
    provider.keys.clear()
    await client.generate("p")
    assert provider.keys == [FIRST]


async def test_a_resting_key_is_asked_anyway_when_the_other_runs_out():
    provider = Provider(IN_FLIGHT)
    client = _client(provider)
    await client.generate("p")

    provider.answers = {FIRST: OK, SECOND: TOO_DEAR}
    provider.keys.clear()
    content, _ = await client.generate("p")
    assert content == '{"ok": true}'
    assert provider.keys == [SECOND, FIRST]


async def test_when_neither_key_can_pay_the_usual_stop_comes_back(no_waiting):
    provider = Provider(IN_FLIGHT, TOO_DEAR)
    with pytest.raises(OpenRouterError) as refused:
        await _client(provider).generate("p")

    assert refused.value.status_code == 402
    classified = classify_error(refused.value)
    assert classified.code == INSUFFICIENT_CREDITS and classified.retryable is False
    assert provider.keys == [FIRST, SECOND], "each key once, with no retries"
    no_waiting.assert_not_awaited()


async def test_calls_at_once_all_land_on_the_other_key_and_stay_there():
    provider = Provider(IN_FLIGHT)
    client = _client(provider)
    answers = await asyncio.gather(*(client.generate("p") for _ in range(4)))
    assert [content for content, _ in answers] == ['{"ok": true}'] * 4
    assert provider.keys.count(SECOND) == 4

    provider.keys.clear()
    await client.generate("p")
    assert provider.keys == [SECOND], "several refusals at once must not flip back to the empty key"


async def test_a_spent_key_limit_moves_to_the_other_key():
    provider = Provider(KEY_LIMIT)
    content, _ = await _client(provider).generate("p")
    assert content == '{"ok": true}'
    assert provider.keys == [FIRST, SECOND]


async def test_a_spent_key_limit_is_reported_as_no_credit():
    provider = Provider(KEY_LIMIT)
    with pytest.raises(OpenRouterError) as refused:
        await _client(provider, second_key=None).generate("p")
    assert classify_error(refused.value).code == INSUFFICIENT_CREDITS


@pytest.mark.parametrize("answer", [MODERATED, BAD_KEY, BAD_REQUEST], ids=["moderated", "bad_key", "bad_request"])
async def test_a_refusal_that_is_not_about_credit_stays_on_the_first_key(answer):
    provider = Provider(answer)
    with pytest.raises(OpenRouterError) as refused:
        await _client(provider).generate("p")
    assert provider.keys == [FIRST]
    assert classify_error(refused.value).code != INSUFFICIENT_CREDITS


@pytest.mark.parametrize("answer", [RATE_LIMITED, SERVER_ERROR], ids=["rate_limited", "server_error"])
async def test_a_passing_failure_is_retried_on_the_same_key(answer):
    provider = Provider(answer)
    with pytest.raises(OpenRouterError):
        await _client(provider).generate("p")
    assert provider.keys == [FIRST, FIRST, FIRST]


async def test_a_timeout_is_retried_on_the_same_key():
    keys: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        keys.append(request.headers["authorization"].removeprefix("Bearer "))
        raise httpx.ReadTimeout("slow", request=request)

    client = OpenRouterClient(api_key=FIRST, second_key=SECOND)
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(OpenRouterError):
        await client.generate("p")
    assert keys == [FIRST, FIRST, FIRST]


async def test_with_one_key_a_refusal_stops_as_it_always_has(caplog):
    provider = Provider(IN_FLIGHT)
    with caplog.at_level(logging.WARNING, logger="promptmaster.llm_client"):
        with pytest.raises(OpenRouterError) as refused:
            await _client(provider, second_key=None).generate("p")
    assert provider.keys == [FIRST]
    assert classify_error(refused.value).code == INSUFFICIENT_CREDITS
    assert "openrouter_key_refused_for_credit" not in caplog.text


@pytest.mark.parametrize("second", [None, "", "   ", FIRST, f" {FIRST}\n"], ids=["none", "empty", "blank", "same", "same_padded"])
def test_a_missing_blank_or_repeated_second_key_is_no_second_key(second):
    assert OpenRouterClient(api_key=FIRST, second_key=second)._keys == [FIRST]


def test_a_blank_key_is_refused_when_the_client_is_made(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(ValueError, match="API key required"):
        OpenRouterClient(api_key="   ")


def test_a_stray_newline_on_a_key_is_trimmed():
    assert OpenRouterClient(api_key=f"{FIRST}\n", second_key=f" {SECOND}\n")._keys == [FIRST, SECOND]


async def test_the_refused_key_is_logged_by_number_once_and_never_by_value(caplog):
    provider = Provider(IN_FLIGHT, TOO_DEAR)
    client = _client(provider)
    with caplog.at_level(logging.WARNING, logger="promptmaster.llm_client"):
        for _ in range(2):
            with pytest.raises(OpenRouterError) as refused:
                await client.generate("p")

    notices = [r for r in caplog.records if r.getMessage() == "openrouter_key_refused_for_credit"]
    assert [r.key_number for r in notices] == [1, 2], "once per key, while it rests"
    for secret in (FIRST, SECOND):
        assert secret not in caplog.text
        assert secret not in str(refused.value)


def test_the_app_reads_the_second_key_from_its_own_variable(monkeypatch):
    monkeypatch.delenv("PM_LLM_MODE", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", FIRST)
    monkeypatch.setenv("OPENROUTER_API_KEY_2", SECOND)
    assert deps._build_client()._keys == [FIRST, SECOND]


def test_the_second_variable_is_optional(monkeypatch):
    monkeypatch.delenv("PM_LLM_MODE", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", FIRST)
    monkeypatch.delenv("OPENROUTER_API_KEY_2", raising=False)
    assert deps._build_client()._keys == [FIRST]
