"""The options a reserved approval offers, read from the stage's text (12 Nov)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.decision_options import (
    MAX_OPTIONS, OPTIONS_INSTRUCTION, OPTIONS_MODEL, DecisionOptionsRequest, build_options_prompt, parse_options,
)
from promptmaster.mock_llm import _json_reply
from promptmaster.schemas import PMInput

STAGE = (
    "# Decide on the cap change\n\n"
    "Status: Awaiting the user's decision.\n\n"
    "- Option A: raise the cap to $195,000 per hire for both searches. Morgan and Jordan join the shortlists.\n"
    "- Option B: keep the approved cap of $180,000 per hire. The shortlists stay as they are.\n"
)


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _inputs(**over) -> dict:
    return {"objective": "Shortlists for two searches.", "audience": "", "constraints": "Only I can approve a cap change.", "output_format": "", "mode": "architect", **over}


def _req(**over) -> DecisionOptionsRequest:
    return DecisionOptionsRequest(**{"inputs": PMInput(**_inputs()), "approval": "I approve this decision on the cap.", "stage_label": "Cap decision", "content": STAGE, **over})


def test_prompt_carries_the_approval_the_stage_text_and_the_users_facts():
    req = _req(inputs=PMInput(**_inputs(facts=[{"statement": "Approved cap: $180,000 per hire.", "kind": "fact"}])))
    system, user = build_options_prompt(req)
    assert system == OPTIONS_INSTRUCTION
    assert "THE APPROVAL: I approve this decision on the cap." in user
    assert "THE STAGE: Cap decision" in user
    assert "Option A: raise the cap to $195,000" in user
    assert "Approved cap: $180,000 per hire." in user
    assert "Only I can approve a cap change." in user
    assert "Never write an option the text does not state" in system
    assert "never recommend one" in system


def test_an_option_is_kept_only_with_its_passage_found_in_the_text():
    out = parse_options({"question": "Raise the cap or keep it?", "options": [
        {"label": "Option A: raise the cap to $195,000 for both searches", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Option B: keep the $180,000 cap", "quote": "Option B: keep the approved cap of $180,000 per hire."},
        {"label": "Option C: raise it for the Controller search only", "quote": "Option C: raise the cap for the Controller search only."},
    ]}, STAGE)
    assert [o.label for o in out.options] == ["Option A: raise the cap to $195,000 for both searches", "Option B: keep the $180,000 cap"]
    assert out.question == "Raise the cap or keep it?"


def test_one_traceable_option_is_no_choice():
    out = parse_options({"question": "?", "options": [
        {"label": "Option A", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Something else entirely", "quote": "A passage the stage does not hold at all."},
    ]}, STAGE)
    assert out.options == [] and out.question == ""


def test_the_same_option_twice_is_one_and_there_are_never_more_than_four():
    quote = "Option A: raise the cap to $195,000 per hire for both searches."
    out = parse_options({"options": [{"label": "Option A", "quote": quote}, {"label": "option a.", "quote": quote}]}, STAGE)
    assert out.options == []
    text = "\n".join(f"Option {n}: do the thing numbered {n} for this plan." for n in "ABCDEF")
    out = parse_options({"options": [{"label": f"Option {n}", "quote": f"Option {n}: do the thing numbered {n} for this plan."} for n in "ABCDEF"]}, text)
    assert len(out.options) == MAX_OPTIONS


def test_anything_but_an_object_gives_no_options():
    assert parse_options(None, STAGE).options == []
    assert parse_options({"options": "Option A"}, STAGE).options == []
    assert parse_options({"options": [None, "x", {"label": "", "quote": ""}]}, STAGE).options == []


def test_the_route_returns_the_traced_options_from_one_small_call(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"question": "Raise the cap?", "options": [
        {"label": "Option A: $195,000 for both searches", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Option B: keep $180,000", "quote": "Option B: keep the approved cap of $180,000 per hire."},
    ]}, {})
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this decision on the cap.", "stage_label": "Cap decision", "content": STAGE})
    assert res.status_code == 200
    assert [o["label"] for o in res.json()["options"]] == ["Option A: $195,000 for both searches", "Option B: keep $180,000"]
    assert mock.generate_json.await_count == 1
    assert mock.generate_json.await_args.kwargs["model"] == OPTIONS_MODEL


def test_a_failed_call_or_an_empty_stage_answers_with_none_and_never_an_error(client_for_app):
    http, mock = client_for_app
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this.", "content": STAGE})
    assert res.status_code == 200 and res.json() == {"question": "", "options": []}
    mock.generate_json.reset_mock(side_effect=True)
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this.", "content": "  "})
    assert res.json()["options"] == [] and mock.generate_json.await_count == 0


def test_the_mock_offers_the_options_the_stage_text_names():
    system, user = build_options_prompt(_req())
    out = parse_options(_json_reply(system, user), STAGE)
    assert [o.label[:8] for o in out.options] == ["Option A", "Option B"]
    system, user = build_options_prompt(_req(content="# Brief\n\nThe brief is complete."))
    assert parse_options(_json_reply(system, user), "# Brief\n\nThe brief is complete.").options == []
