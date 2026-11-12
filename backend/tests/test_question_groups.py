"""Which of the things waiting on the user one answer would settle (12 Nov)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.mock_llm import _json_reply
from promptmaster.question_groups import GROUPS_INSTRUCTION, GROUPS_MODEL, GroupQuestionsRequest, WaitingItem, build_groups_prompt, parse_groups
from promptmaster.schemas import PMInput


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _inputs() -> dict:
    return {"objective": "Plan training for 72 employees.", "audience": "", "constraints": "", "output_format": "", "mode": "architect"}


def _req() -> GroupQuestionsRequest:
    return GroupQuestionsRequest(inputs=PMInput(**_inputs()), items=[
        WaitingItem(id="carried:check:i5", stage="Coverage check", text="The no-absence assumption is untested: confirm absences or leave."),
        WaitingItem(id="kept_question:brief:s9", stage="Leadership brief", text="Should the brief treat absence as a risk or as settled?"),
        WaitingItem(id="kept_question:schedule:s3", stage="Schedule", text="Is one trainer enough for the week?"),
    ])


def test_prompt_lists_each_item_by_id_and_stage_and_asks_for_one_question_per_group():
    system, user = build_groups_prompt(_req())
    assert system == GROUPS_INSTRUCTION
    assert "[carried:check:i5] Coverage check: The no-absence assumption is untested" in user
    assert "[kept_question:schedule:s3] Schedule: Is one trainer enough for the week?" in user
    assert "one answer really settles together" in system
    assert "When in doubt, leave an item out" in system
    assert "do not recommend an answer" in system


def test_a_group_is_kept_with_two_or_more_ids_that_were_sent():
    out = parse_groups({"groups": [
        {"ids": ["carried:check:i5", "kept_question:brief:s9"], "question": "Are any absences or leave expected during the training week?", "choices": ["None", "Yes, I will give the figures", "none"]},
    ]}, _req())
    assert len(out.groups) == 1
    assert out.groups[0].ids == ["carried:check:i5", "kept_question:brief:s9"]
    assert out.groups[0].question == "Are any absences or leave expected during the training week?"
    assert out.groups[0].choices == ["None", "Yes, I will give the figures"]


def test_an_unknown_id_a_group_of_one_a_reused_id_or_no_question_is_dropped():
    out = parse_groups({"groups": [
        {"ids": ["carried:check:i5", "made:up"], "question": "Absences?"},
        {"ids": ["carried:check:i5", "kept_question:brief:s9"], "question": ""},
        {"ids": ["carried:check:i5", "kept_question:brief:s9"], "question": "Are absences expected?"},
        {"ids": ["kept_question:brief:s9", "kept_question:schedule:s3"], "question": "Something else?"},
        "nonsense",
    ]}, _req())
    assert [g.ids for g in out.groups] == [["carried:check:i5", "kept_question:brief:s9"]]
    assert out.groups[0].choices == []
    assert parse_groups(None, _req()).groups == []
    assert parse_groups({"groups": "x"}, _req()).groups == []


def test_the_route_makes_one_small_call_and_none_for_a_single_item(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"groups": [{"ids": ["a", "b"], "question": "Are absences expected?", "choices": ["None", "Some"]}]}, {})
    body = {"inputs": _inputs(), "items": [{"id": "a", "stage": "Check", "text": "Confirm absences."}, {"id": "b", "stage": "Brief", "text": "Is absence a risk?"}]}
    res = http.post("/api/agent/group-questions", json=body)
    assert res.status_code == 200
    assert res.json()["groups"] == [{"ids": ["a", "b"], "question": "Are absences expected?", "choices": ["None", "Some"]}]
    assert mock.generate_json.await_args.kwargs["model"] == GROUPS_MODEL
    mock.generate_json.reset_mock()
    res = http.post("/api/agent/group-questions", json={"inputs": _inputs(), "items": body["items"][:1]})
    assert res.json() == {"groups": []} and mock.generate_json.await_count == 0


def test_a_failed_call_groups_nothing(client_for_app):
    http, mock = client_for_app
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/group-questions", json={"inputs": _inputs(), "items": [{"id": "a", "text": "x one"}, {"id": "b", "text": "x two"}]})
    assert res.status_code == 200 and res.json() == {"groups": []}


def test_the_mock_groups_the_items_about_absence():
    system, user = build_groups_prompt(_req())
    out = parse_groups(_json_reply(system, user), _req())
    assert [g.ids for g in out.groups] == [["carried:check:i5", "kept_question:brief:s9"]]
