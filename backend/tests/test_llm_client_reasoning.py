"""A reasoning model's reasoning gets its own budget (18 Oct, same-model pilot),
and a retired model is replaced rather than called (18 Oct: GPT-5.4 retired)."""

from promptmaster.llm_client import DEFAULT_MODEL, REASONING_HEADROOM, OpenRouterClient, _token_budget, resolve_model


def test_a_reasoning_model_keeps_the_answer_budget_and_reasons_on_top():
    for model in ("anthropic/claude-opus-5.5", "anthropic/claude-haiku-5.5", "openai/gpt-5.6-sol"):
        assert _token_budget(model, 900) == {
            "max_tokens": 900 + REASONING_HEADROOM, "reasoning": {"max_tokens": REASONING_HEADROOM},
        }


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
