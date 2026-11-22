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
    assert res.json()["actions"] == [{"label": "Tighten the opening", "kind": "revise", "instruction": "Shorten it.", "updates": [], "rows": [], "facts": []}]
    system = client.generate_json.call_args.kwargs["system"]
    assert "TURN AN ANSWER INTO ACTIONS" in system


def test_a_pasted_report_is_not_offered_as_a_fact_unless_asked():
    """5 Nov (a rollout pack): a review of a simulated agent report was offered as facts,
    recorded with a click, and reached the approved pack."""
    from promptmaster.reply_actions import _FACTS_KIND

    assert "Text the user pasted for you to review" in _FACTS_KIND
    assert 'add "reported": true' in _FACTS_KIND


def test_reported_survives_parsing_and_only_true_counts():
    from promptmaster.reply_actions import parse_record_facts

    q = "Record this: the vendor says it moved the date to November 20."
    item = {"facts": [{"statement": "The vendor says it moved the date to November 20.", "reported": True}]}
    assert parse_record_facts(item, q)[0].reported is True
    item = {"facts": [{"statement": "The vendor says it moved the date to November 20.", "reported": "yes"}]}
    assert parse_record_facts(item, q)[0].reported is False


def test_one_items_statement_never_replaces_another_items_fact():
    """L-270, 21 Nov (Sean, scanner): a change to Option B's training charge was
    recorded over Option A's and Option C's facts."""
    from promptmaster.reply_actions import parse_record_facts

    q = "Option B's training charge alone has gone from $6,000 to $7,500."
    a = "Option A: one vendor; $47,000 equipment and installation + $6,000 training"
    b = "Option B: two vendors; $49,000 equipment and installation + $6,000 training"
    general = "Each option includes a $6,000 training charge."
    known = [a, b, general]
    stmt = "Option B: two vendors; $49,000 equipment and installation + $7,500 training"
    for wrong in (a, general):
        item = {"facts": [{"statement": stmt, "replaces": wrong}]}
        assert parse_record_facts(item, q + " $49,000", known)[0].replaces == ""
    item = {"facts": [{"statement": stmt, "replaces": b}]}
    assert parse_record_facts(item, q + " $49,000", known)[0].replaces == b


def test_a_statement_never_replaces_the_users_decision():
    """L-278, 22 Nov (production pass of Sean's scanner case): the user's decision on
    Option B was offered for rewriting as "… now $61,500"; superseded so, it was never
    set aside and its approval stayed ticked."""
    from promptmaster.fact_filters import is_decision_line
    from promptmaster.reply_actions import parse_record_facts

    decision = 'Decided by the user — on "I choose the option to approve" (Decision): Option B: two vendors, $60,000 all-in, all three sites live by December 18.'
    q = "Option B's training charge alone has gone from $6,000 to $7,500, so Option B: two vendors, $61,500 all-in, all three sites live by December 18."
    stmt = "Option B: two vendors, $61,500 all-in, all three sites live by December 18"
    out = parse_record_facts({"facts": [{"statement": stmt, "replaces": decision}]}, q, [decision])
    assert out and out[0].replaces == ""
    assert is_decision_line("Decision: Decided by the user: Approve Option B at $60,000.")
    assert not is_decision_line("Option B: two vendors; $49,000 equipment and installation + $6,000 training")


def test_item_labels_match_the_frontend():
    from promptmaster.fact_filters import about_another_item, item_labels

    assert item_labels("The Option B vendor") == {"option": {"B"}}
    assert item_labels("Options A and C miss the deadline") == {"option": {"A", "C"}}
    assert item_labels("live by December 18, Friday 9 a.m.") == {}
    assert item_labels("the Option Board met") == {}
    s = "The Option B vendor has corrected the training charge from $6,000 to $7,500."
    assert about_another_item(s, "Option A: one vendor; $47,000 + $6,000 training")
    assert not about_another_item(s, "Option B: two vendors; $49,000 + $6,000 training")
    assert not about_another_item(s, "Requirement: Hard $60,000 all-in budget")
    assert about_another_item(s, "Each option includes a $6,000 training charge.")
    assert not about_another_item("All options now include $7,500 training.", "Option A: $6,000 training")
