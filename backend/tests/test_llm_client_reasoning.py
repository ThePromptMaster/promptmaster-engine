"""An Anthropic model's reasoning gets its own budget (18 Oct, same-model pilot)."""

from promptmaster.llm_client import REASONING_HEADROOM, _token_budget


def test_an_anthropic_model_keeps_the_answer_budget_and_reasons_on_top():
    assert _token_budget("anthropic/claude-opus-5.5", 900) == {
        "max_tokens": 900 + REASONING_HEADROOM, "reasoning": {"max_tokens": REASONING_HEADROOM},
    }


def test_other_models_are_sent_as_before():
    assert _token_budget("openai/gpt-5.4", 900) == {"max_tokens": 900}
