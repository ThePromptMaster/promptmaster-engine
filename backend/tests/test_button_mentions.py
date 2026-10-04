"""Only real buttons are named to the user (3 Oct call: "Press Generate Outline"
on a stage with no such button)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.agent import AgentControl, parse_next_action
from promptmaster.page_context import PageButton, scrub_button_mentions

BUTTONS = [PageButton(label="Generate the outline"), PageButton(label="Draft this stage")]


def test_an_invented_button_is_rewritten_as_plain_words():
    out = scrub_button_mentions("Next, press Generate Outline to start.", [PageButton(label="Approve")])
    assert out == "Next, generate outline (there is no button for this on this page) to start."


def test_a_near_miss_is_corrected_to_the_page_words():
    assert scrub_button_mentions("Press Generate Outline.", BUTTONS) == 'Press "Generate the outline".'


def test_a_real_button_is_kept_and_quoted():
    assert scrub_button_mentions('Click "Draft this stage" now.', BUTTONS) == 'Click "Draft this stage" now.'


def test_legacy_names_are_rewritten():
    out = scrub_button_mentions("Click 'Refine Prompt' and replace the objective.", BUTTONS)
    assert "Refine Prompt'" not in out
    assert out.startswith("Refine prompt (there is no button for this on this page)")


def test_ordinary_sentences_are_left_alone():
    for text in ("Use Chapter 2 as the model.", "I will press on with Chapter 3.",
                 "Use 'Stay within scope' as a constraint.", "Select the second option."):
        assert scrub_button_mentions(text, BUTTONS) == text


def test_sentence_start_stays_capitalised():
    assert scrub_button_mentions("Press the Approve This Outline button.", BUTTONS).startswith("Approve this outline (")


def test_planner_free_text_is_checked_against_the_page():
    action = parse_next_action(
        {
            "action_key": "request_user_decision",
            "params": {},
            "rationale": "The outline is next. Press Generate Outline.",
            "expected_outcome": "Then press Resume.",
            "decision_question": "Should I click 'Draft This Stage'?",
        },
        ["request_user_decision"],
        [AgentControl(label="Draft this stage", where="the main button")],
    )
    assert "there is no button for this on this page" in action.rationale
    assert action.expected_outcome == 'Then press "Resume".'
    assert action.decision_question == 'Should I click "Draft this stage"?'


def _chat(context):
    stub = AsyncMock()
    stub.generate = AsyncMock(return_value=("Press Generate Outline to continue.", {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        body = {
            "inputs": {"objective": "A book about lions", "audience": "", "mode": "architect"},
            "active_iteration": {"iteration_number": 1, "prompt_sent": "", "system_prompt_used": "", "output": "x", "mode": "architect"},
            "user_message": "What next?",
        }
        if context is not None:
            body["context"] = context
        r = TestClient(app).post("/api/chat-message", json=body)
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    return r.json()["assistant_message"]["content"]


def test_chat_reply_is_checked_when_the_buttons_are_known():
    assert "there is no button for this on this page" in _chat({"stage_label": "Approval", "buttons": []})


def test_chat_reply_is_untouched_when_the_buttons_are_not_known():
    assert _chat(None) == "Press Generate Outline to continue."
