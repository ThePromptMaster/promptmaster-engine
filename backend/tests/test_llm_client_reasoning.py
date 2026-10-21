"""A reasoning model's reasoning gets its own budget (18 Oct, same-model pilot),
and a retired model is replaced rather than called (18 Oct: GPT-5.4 retired)."""

import httpx
import pytest

from observability import UsageAccumulator, usage_var
from promptmaster.llm_client import (
    DEFAULT_MODEL,
    LONG_ANSWER_TOKENS,
    REASONING_HEADROOM,
    OpenRouterClient,
    OpenRouterError,
    _token_budget,
    resolve_model,
)


def test_a_reasoning_model_keeps_the_answer_budget_and_reasons_on_top():
    for model in ("anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5", "openai/gpt-5.6-sol"):
        assert _token_budget(model, 900) == {
            "max_tokens": 900 + REASONING_HEADROOM, "reasoning": {"max_tokens": REASONING_HEADROOM},
        }


def test_a_writing_call_reasons_at_low_effort_so_the_answer_keeps_its_room():
    """19 Oct: a reasoning budget is a hint Opus 5.5 overruns; on a long merge it
    spent all 14,048 tokens reasoning and returned no text."""
    for model in ("anthropic/claude-opus-5.5", "openai/gpt-5.6-sol"):
        assert _token_budget(model, 12_000) == {
            "max_tokens": 12_000 + REASONING_HEADROOM, "reasoning": {"effort": "low"},
        }
        assert _token_budget(model, LONG_ANSWER_TOKENS)["reasoning"] == {"effort": "low"}
        assert _token_budget(model, LONG_ANSWER_TOKENS - 1)["reasoning"] == {"max_tokens": REASONING_HEADROOM}


async def test_a_reply_spent_wholly_on_reasoning_is_still_metered():
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
            "usage": {"prompt_tokens": 23831, "completion_tokens": 14048},
        })

    client = OpenRouterClient(api_key="k")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    acc = UsageAccumulator()
    token = usage_var.set(acc)
    try:
        with pytest.raises(OpenRouterError, match="No content"):
            await client._single_request({"model": "anthropic/claude-opus-5.5"}, {}, attempt=1)
    finally:
        usage_var.reset(token)
    assert [(e.tokens_in, e.tokens_out) for e in acc.events] == [(23831, 14048)]


def test_other_models_are_sent_as_before():
    assert _token_budget("openai/gpt-4o", 900) == {"max_tokens": 900}


def test_the_default_is_opus_and_retired_models_are_replaced():
    assert DEFAULT_MODEL == OpenRouterClient.DEFAULT_MODEL == "anthropic/claude-opus-5.5"
    assert resolve_model("openai/gpt-5.4") == DEFAULT_MODEL
    assert resolve_model("anthropic/claude-sonnet-4") == "anthropic/claude-sonnet-5.5"
    assert resolve_model("openai/gpt-5.6-sol") == "openai/gpt-5.6-sol"


async def test_a_project_still_set_to_gpt_5_4_runs_on_the_default(monkeypatch):
    client = OpenRouterClient(api_key="k")
    sent = {}

    async def fake(payload, headers, timeout, deadline):
        sent.update(payload)
        return "ok", {}, "stop"

    monkeypatch.setattr(client, "_request_with_retries", fake)
    await client.generate("hi", model="openai/gpt-5.4")
    assert sent["model"] == DEFAULT_MODEL


def test_deep_thinking_reasons_at_high_effort_and_keeps_the_answer_budget():
    """14 Oct call: a project can ask the model to think harder (Thinking: Deep)."""
    from observability import thinking_var
    from promptmaster.llm_client import DEEP_HEADROOM

    token = thinking_var.set("deep")
    try:
        for max_tokens in (900, 12_000):
            assert _token_budget("anthropic/claude-opus-5.5", max_tokens) == {
                "max_tokens": max_tokens + DEEP_HEADROOM, "reasoning": {"effort": "high"},
            }
        # A model that does not reason is sent as before, whatever the level.
        assert _token_budget("openai/gpt-4o", 900) == {"max_tokens": 900}
    finally:
        thinking_var.reset(token)


def test_the_thinking_header_sets_the_level_for_the_request_and_nothing_else():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from observability import THINKING_HEADER, ObservabilityMiddleware, parse_thinking, thinking_var

    app = FastAPI()
    app.add_middleware(ObservabilityMiddleware)

    @app.get("/level")
    async def level():
        return {"thinking": thinking_var.get()}

    client = TestClient(app)
    assert client.get("/level", headers={THINKING_HEADER: "deep"}).json() == {"thinking": "deep"}
    assert client.get("/level").json() == {"thinking": "standard"}
    # Anything unrecognised is Standard: an unknown level never raises the bill.
    assert parse_thinking("maximum") == "standard"
