"""A folder's rule and something said lower down that cannot both hold; and the
stages that wait on the user's choice (Sean, 23 Nov, "Inheritance & exceptions":
"surface both ... pause the reference work that depends on the answer and let the
rest of the search continue")."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.inherited_mismatch import (
    MISMATCH_MODEL, InheritedRule, LowerStatement, MismatchRequest, build_mismatch_prompt, parse_mismatches,
)
from promptmaster.project_context import facts_block
from promptmaster.schemas import AcceptedFact, PMInput
from promptmaster.stages_concerned import (
    CONCERNED_MODEL, ConcernedStage, StagesConcernedRequest, build_concerned_prompt, parse_concerned,
)

RULE = InheritedRule(id="r-refs", statement="The client handles reference checks.", scope='the client folder "Acme"', required=True)
OTHER = InheritedRule(id="r-pdf", statement="Reports go to the client as PDF.", scope='the client folder "Acme"')
NOTE = LowerStatement(id="n-1", statement="We are handling references on this search.", place='the search folder "CFO"')
BELOW = LowerStatement(id="d-1", statement="Shortlist reports go as Word files.", place='the folder "Interviews"', kind="below")


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _req() -> MismatchRequest:
    return MismatchRequest(rules=[RULE, OTHER], statements=[NOTE, BELOW])


def test_the_prompt_numbers_rules_new_statements_and_rules_below_and_says_a_later_note_does_not_win():
    system, user = build_mismatch_prompt(_req())
    assert '[I1] The client handles reference checks. (set in the client folder "Acme") (required)' in user
    assert '[A1] We are handling references on this search. (said in the search folder "CFO")' in user
    assert '[D1] Shortlist reports go as Word files. (set in the folder "Interviews")' in user
    assert "A statement that says it is an exception is still a mismatch" in system
    assert "If you are unsure, it is not a mismatch." in system


def test_a_pair_is_kept_only_with_both_quotes_found_and_its_ids_are_the_rows():
    out = parse_mismatches({"mismatches": [
        {"rule": "I1", "statement": "A1", "rule_quote": "client handles reference checks", "statement_quote": "We are handling references", "explanation": "Who runs references."},
        {"rule": "I2", "statement": "D1", "rule_quote": "Reports go to the client as PDF", "statement_quote": "go as Word files", "explanation": "Format."},
        # A quote not in the statement: dropped.
        {"rule": "I1", "statement": "D1", "rule_quote": "client handles reference checks", "statement_quote": "references are ours"},
        # An unknown label: dropped.
        {"rule": "I9", "statement": "A1", "rule_quote": "x" * 10, "statement_quote": "We are handling references"},
    ]}, _req())
    assert [(m.rule_id, m.statement_id) for m in out.mismatches] == [("r-refs", "n-1"), ("r-pdf", "d-1")]
    assert out.checked is True
    assert parse_mismatches("not json", _req()).mismatches == []


def test_the_route_makes_one_small_call_and_a_failure_finds_nothing_and_says_it_did_not_check(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"mismatches": [{"rule": "I1", "statement": "A1", "rule_quote": "client handles reference checks", "statement_quote": "We are handling references", "explanation": "Who runs references."}]}, {})
    res = http.post("/api/inherited-mismatches", json=_req().model_dump())
    assert res.status_code == 200
    body = res.json()
    assert body["checked"] is True and body["mismatches"][0]["rule_id"] == "r-refs"
    assert mock.generate_json.await_args.kwargs["model"] == MISMATCH_MODEL
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/inherited-mismatches", json=_req().model_dump())
    assert res.status_code == 200 and res.json() == {"mismatches": [], "checked": False}


def test_nothing_to_read_makes_no_call(client_for_app):
    http, mock = client_for_app
    res = http.post("/api/inherited-mismatches", json={"rules": [], "statements": [NOTE.model_dump()]})
    assert res.json() == {"mismatches": [], "checked": True} and mock.generate_json.await_count == 0


STAGES = [
    ConcernedStage(id="brief", label="Search brief", instruction="Summarise the role and the client's requirements."),
    ConcernedStage(id="refs", label="Referencing", instruction="Plan who calls which referees and when."),
    ConcernedStage(id="report", label="Candidate report", instruction="Write the report for the client."),
]


def test_a_stage_is_held_only_with_words_of_its_own_name_or_instruction():
    req = StagesConcernedRequest(rule=RULE.statement, statement=NOTE.statement, explanation="Who runs references.", stages=STAGES)
    system, user = build_concerned_prompt(req)
    assert "FIRST INSTRUCTION: The client handles reference checks." in user and "[refs] Referencing" in user
    assert "If you are unsure, leave it out." in system
    out = parse_concerned({"stages": [
        {"stage_id": "refs", "quote": "Referencing"},
        {"stage_id": "report", "quote": "who calls the referees"},  # not in its own words
        {"stage_id": "ghost", "quote": "Referencing"},
    ]}, req)
    assert [(s.stage_id, s.quote) for s in out.stages] == [("refs", "Referencing")]


def test_the_stages_route_names_none_on_any_failure(client_for_app):
    http, mock = client_for_app
    req = StagesConcernedRequest(rule=RULE.statement, statement=NOTE.statement, stages=STAGES).model_dump()
    mock.generate_json.return_value = ({"stages": [{"stage_id": "refs", "quote": "Plan who calls which referees"}]}, {})
    res = http.post("/api/agent/stages-concerned", json=req)
    assert res.json() == {"stages": [{"stage_id": "refs", "quote": "Plan who calls which referees"}], "checked": True}
    assert mock.generate_json.await_args.kwargs["model"] == CONCERNED_MODEL
    mock.generate_json.side_effect = RuntimeError("down")
    assert http.post("/api/agent/stages-concerned", json=req).json() == {"stages": [], "checked": False}


def _inputs(*facts: AcceptedFact) -> PMInput:
    return PMInput(objective="Plan the references", audience="Consultants", mode="analyst", facts=list(facts))


def test_an_unresolved_pair_is_relied_on_by_neither_side():
    block = facts_block(_inputs(
        AcceptedFact(statement="The client handles reference checks.", kind="requirement", required=True, scope='the client folder "Acme"',
                     source='from the client folder "Acme"', unresolved_with='We are handling references on this search. (set in the search folder "CFO")'),
    ))
    assert 'UNRESOLVED: this disagrees with "We are handling references on this search. (set in the search folder "CFO")"' in block
    assert "Rely on neither: write nothing that turns on which one holds, and say that it waits on the user's choice" in block
    assert 'unless the two are marked UNRESOLVED below, when neither is relied on' in block


def test_an_exception_says_who_authorised_it_and_what_it_sets_aside():
    block = facts_block(_inputs(
        AcceptedFact(statement="We run reference checks on this search.", kind="requirement", scope='the search folder "CFO"',
                     source='an exception recorded for the search folder "CFO", 24 Nov',
                     exception='authorised by Dana Ruiz, confirmed email of 12 Nov, because the client asked. It sets aside here the required rule "The client handles reference checks." of the client folder "Acme", which still holds everywhere else'),
    ))
    assert "(an exception recorded for this project's folders: authorised by Dana Ruiz, confirmed email of 12 Nov" in block
    assert "which still holds everywhere else)" in block
