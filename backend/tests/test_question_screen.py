"""The screen on questions Go wants to ask (8 Nov)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.question_screen import SCREEN_MODEL, ScreenQuestionRequest, build_screen_prompt, parse_screen
from promptmaster.schemas import PMInput


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _inputs(**over) -> dict:
    return {"objective": "An operations handoff.", "audience": "", "constraints": "This is document preparation only.", "output_format": "roughly 900 words", "mode": "architect", **over}


def _req(**over) -> ScreenQuestionRequest:
    return ScreenQuestionRequest(inputs=PMInput(**_inputs()), question="Has anyone been confirmed in writing?", stage_label="Final", earlier_stages=["Brief", "Manuscript"], reserved_approvals=["I approve this."], **over)


def test_prompt_carries_the_users_words_and_nothing_a_model_wrote():
    req = ScreenQuestionRequest(
        inputs=PMInput(**_inputs(facts=[{"statement": "Budget is 6,000.", "kind": "fact"}, {"statement": "Assumed vendor quote.", "kind": "fact", "origin": "model_assumed"}])),
        question="Shall I shorten it?", stage_label="Final", earlier_stages=["Brief"], reserved_approvals=["I approve this."], delegation=["Make routine drafting decisions yourself."],
    )
    system, user = build_screen_prompt(req)
    assert "This is document preparation only." in user
    assert "Budget is 6,000." in user
    assert "Assumed vendor quote." not in user
    assert "Make routine drafting decisions yourself." in user
    assert "- I approve this." in user
    assert "Shall I shorten it?" in user
    assert "A practice the assistant suggested itself" in system
    assert "choose business_decision" in system


def test_endpoint_uses_a_small_model_and_returns_the_verdict(client_for_app):
    api, mock = client_for_app
    mock.generate_json = AsyncMock(return_value=({"verdict": "real_world_action", "reason": "Outside the document.", "action": "Confirm cover for the hour."}, {}))
    r = api.post("/api/agent/screen-question", json={"inputs": _inputs(), "question": "Has anyone been confirmed?", "stage_label": "Final"})
    assert r.status_code == 200
    assert r.json()["verdict"] == "real_world_action"
    assert r.json()["action"] == "Confirm cover for the hour."
    assert mock.generate_json.call_args.kwargs["model"] == SCREEN_MODEL


def test_a_failed_screen_means_ask(client_for_app):
    api, mock = client_for_app
    mock.generate_json = AsyncMock(side_effect=RuntimeError("no"))
    r = api.post("/api/agent/screen-question", json={"inputs": _inputs(), "question": "Shall I?", "stage_label": "Final"})
    assert r.status_code == 200
    assert r.json()["verdict"] == "business_decision"


def test_unusable_verdicts_fall_back_to_asking():
    assert parse_screen({"verdict": "nonsense"}, _req()).verdict == "business_decision"
    assert parse_screen({"verdict": "routine_repair", "instruction": ""}, _req()).verdict == "business_decision"


def test_a_repair_keeps_its_instruction_and_only_a_listed_stage():
    out = parse_screen({"verdict": "routine_repair", "instruction": "Shorten to 1,200 words.", "target_stage": "manuscript"}, _req())
    assert (out.verdict, out.instruction, out.target_stage) == ("routine_repair", "Shorten to 1,200 words.", "Manuscript")
    assert parse_screen({"verdict": "routine_repair", "instruction": "x", "target_stage": "Elsewhere"}, _req()).target_stage == ""


def test_a_real_world_action_falls_back_to_the_question_as_its_wording():
    assert parse_screen({"verdict": "real_world_action"}, _req()).action == "Has anyone been confirmed in writing?"


def test_a_requirement_must_be_the_users_own_words():
    assert parse_screen({"verdict": "business_decision", "requirement_quote": "document preparation only"}, _req()).requirement_quote == "document preparation only"
    assert parse_screen({"verdict": "business_decision", "requirement_quote": "confirmed in writing"}, _req()).requirement_quote == ""


def test_a_routine_choice_is_a_verdict_of_its_own_and_carries_no_instruction():
    """8 Nov (a client): "Do whatever is best" selected automatically for routine decisions."""
    system, _user = build_screen_prompt(_req())
    assert "routine_choice" in system and "The assistant picks" in system
    assert "unsure between routine_repair or routine_choice and business_decision, choose" in system
    out = parse_screen({"verdict": "routine_choice", "reason": "Either order fits.", "instruction": "Pick one."}, _req())
    assert out.verdict == "routine_choice" and out.instruction == "" and out.reason == "Either order fits."

