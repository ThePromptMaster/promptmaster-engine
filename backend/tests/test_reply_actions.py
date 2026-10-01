"""Side-chat answers as a few actions (1 Oct feedback, items 13, 15, 34): prompt, parsing, route."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.reply_actions import (
    ActionTable, TableField, TableStatus, build_reply_actions_prompt, parse_reply_actions,
)
from promptmaster.schemas import PMInput
from tests.test_self_model import _assert_self_model

INPUTS = PMInput(objective="Diagnose Mid-Market churn", mode="architect")
TABLE = ActionTable(
    item_label="run",
    fields=[TableField(key="run", label="What was to be done"), TableField(key="observed", label="What actually happened")],
    statuses=[TableStatus(value="completed", label="Completed"), TableStatus(value="not_run", label="Not run", requires_reason=True)],
    rows=[{"id": "r1", "run": "Cohort extract"}, {"id": "r2", "run": "Survival model"}],
)


def test_the_prompt_asks_for_few_meaningful_actions_not_one_per_sentence():
    system, user = build_reply_actions_prompt(INPUTS, "Method", "Is the plan sound?", "It is, but two things…", None)
    _assert_self_model(system)
    assert "At most 4 actions; fewer is better" in system
    assert "One action is one decision the user would recognise, not one sentence" in system
    assert "Zero is a fine answer" in system
    assert 'Every action has kind "revise"' in system
    assert "Is the plan sound?" in user
    assert "It is, but two things…" in user
    assert "THE TABLE" not in user


def test_on_a_table_the_prompt_lists_rows_by_id_and_asks_for_row_changes():
    system, user = build_reply_actions_prompt(INPUTS, "Experiment", "What ran?", "Nothing ran.", TABLE)
    assert 'Do not use kind "revise" for a table' in system
    assert "Columns: run (What was to be done), observed (What actually happened)" in user
    assert "Statuses: completed (Completed), not_run (Not run; needs a reason)" in user
    assert "- id=r1: run: Cohort extract" in user


def test_parse_caps_at_four_and_cleans_labels():
    raw = {"actions": [{"label": f"  Do thing {n}.  ", "kind": "revise", "instruction": "x"} for n in range(9)]}
    parsed = parse_reply_actions(raw, None)
    assert len(parsed) == 4
    assert parsed[0].label == "Do thing 0"


def test_parse_drops_what_cannot_be_carried_out():
    raw = {"actions": [
        {"label": "Mark runs not run", "kind": "row_updates", "updates": [
            {"id": "r1", "status": "not_run", "reason": "No data was provided."},
            {"id": "r2", "status": "not_run"},                      # no reason where one is required
            {"id": "ghost", "status": "completed"},                 # not a row
            {"id": "r2", "status": "invented"},                     # not a status
        ]},
        {"label": "Rewrite as prose", "kind": "revise", "instruction": "Make it flow"},   # prose on a table
        {"label": "Add a run", "kind": "add_rows", "rows": [{"run": "Ticket join", "made_up": "x"}, {"made_up": "y"}]},
        {"label": "", "kind": "add_rows", "rows": [{"run": "z"}]},
        {"label": "Nothing left", "kind": "row_updates", "updates": [{"id": "ghost"}]},
    ]}
    parsed = parse_reply_actions(raw, TABLE)
    assert [a.label for a in parsed] == ["Mark runs not run", "Add a run"]
    assert [(u.id, u.status, u.reason) for u in parsed[0].updates] == [("r1", "not_run", "No data was provided.")]
    assert parsed[1].rows == [{"run": "Ticket join"}]


def test_a_table_action_on_a_draft_is_dropped_and_garbage_is_no_actions():
    assert parse_reply_actions({"actions": [{"label": "x", "kind": "row_updates", "updates": [{"id": "r1", "status": "completed"}]}]}, None) == []
    assert parse_reply_actions("nope", None) == []
    assert parse_reply_actions({"actions": "nope"}, TABLE) == []


def test_the_route_returns_parsed_actions():
    client = AsyncMock()
    client.generate_json.return_value = ({"actions": [{"label": "Tighten the opening", "kind": "revise", "instruction": "Shorten it."}]}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/suggest-actions", json={
            "inputs": INPUTS.model_dump(), "stage_label": "Method", "question": "q", "reply": "an answer",
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json()["actions"] == [{"label": "Tighten the opening", "kind": "revise", "instruction": "Shorten it.", "updates": [], "rows": []}]
    system = client.generate_json.call_args.kwargs["system"]
    assert "TURN AN ANSWER INTO ACTIONS" in system
