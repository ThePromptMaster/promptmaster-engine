"""Which open findings the user's own words have settled (12 Nov)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.mock_llm import _json_reply
from promptmaster.schemas import PMInput
from promptmaster.settled_items import SETTLES_INSTRUCTION, SETTLES_MODEL, OpenItem, SettlesRequest, Statement, build_settles_prompt, parse_settles

FINDING = "The no-absence assumption is untested. Any absence in North leaves North at 23, below its minimum of 24. — Next step: confirm absences or leave for Tue–Fri by office."
NOTE = "For this fictional baseline, use the staffing and availability figures provided. There are no additional absences to account for. Keep all coverage minimums in force."


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _inputs() -> dict:
    return {"objective": "Plan training for 72 employees.", "audience": "", "constraints": "", "output_format": "", "mode": "architect"}


def _req(**over) -> SettlesRequest:
    return SettlesRequest(**{
        "inputs": PMInput(**_inputs()),
        "items": [OpenItem(id="i5", stage="Coverage check", text=FINDING, note=NOTE), OpenItem(id="i7", stage="Coverage check", text="The schedule omits the trainer rota.", note="")],
        "statements": [Statement(id="f1", text="Headcount: North 30, Central 24, South 18 (72 total)"), Statement(id="f2", text='Decided by the user — asked "Is one trainer enough?", answered: Yes, one trainer for the whole week.')],
        **over,
    })


def test_prompt_shows_each_finding_beside_the_users_note_and_their_statements():
    system, user = build_settles_prompt(_req())
    assert system == SETTLES_INSTRUCTION
    assert "[i5] Coverage check" in user
    assert "THE USER'S NOTE ON IT: For this fictional baseline" in user
    assert "THE USER'S NOTE ON IT: (none)" in user
    assert "[f2] Decided by the user" in user
    assert "only postpone it" in system
    assert "the work has to change" in system
    assert "If you are unsure, it is not settled" in system


def test_a_finding_is_settled_only_with_words_found_in_the_note_named():
    out = parse_settles({"settled": [
        {"id": "i5", "by": "note", "quote": "There are no additional absences to account for.", "why": "The user states the assumption holds."},
    ]}, _req())
    assert [(s.id, s.by, s.quote) for s in out.settled] == [("i5", "note", "There are no additional absences to account for.")]


def test_words_the_note_does_not_hold_settle_nothing():
    out = parse_settles({"settled": [
        {"id": "i5", "by": "note", "quote": "Absences were confirmed as zero by the office managers.", "why": "x"},
        {"id": "i7", "by": "note", "quote": "The rota is not needed for this plan.", "why": "x"},  # i7 has no note at all
    ]}, _req())
    assert out.settled == []


def test_a_statement_settles_a_finding_when_its_own_words_are_quoted():
    req = _req(items=[OpenItem(id="i8", stage="Coverage check", text="Trainer count is unconfirmed: is one trainer enough?", note="")])
    out = parse_settles({"settled": [
        {"id": "i8", "by": "f2", "quote": "Yes, one trainer for the whole week.", "why": "The user answered it."},
        {"id": "i8", "by": "f1", "quote": "Headcount: North 30", "why": "duplicate id"},
    ]}, req)
    assert [(s.id, s.by) for s in out.settled] == [("i8", "f2")]


def test_an_unknown_finding_an_unknown_statement_or_a_quote_from_the_wrong_one_is_dropped():
    req = _req()
    out = parse_settles({"settled": [
        {"id": "i99", "by": "note", "quote": "There are no additional absences to account for."},
        {"id": "i5", "by": "f9", "quote": "There are no additional absences to account for."},
        {"id": "i5", "by": "f1", "quote": "There are no additional absences to account for."},
        "nonsense", None,
    ]}, req)
    assert out.settled == []
    assert parse_settles(None, req).settled == []
    assert parse_settles({"settled": "i5"}, req).settled == []


def test_the_route_makes_one_small_call_and_returns_what_was_traced(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"settled": [{"id": "i5", "by": "note", "quote": "There are no additional absences to account for.", "why": "Answered."}]}, {})
    res = http.post("/api/agent/settles", json={"inputs": _inputs(), "items": [{"id": "i5", "stage": "Coverage check", "text": FINDING, "note": NOTE}], "statements": []})
    assert res.status_code == 200
    assert res.json()["settled"] == [{"id": "i5", "by": "note", "quote": "There are no additional absences to account for.", "why": "Answered."}]
    assert mock.generate_json.await_args.kwargs["model"] == SETTLES_MODEL


def test_no_words_from_the_user_means_no_call_and_a_failure_settles_nothing(client_for_app):
    http, mock = client_for_app
    res = http.post("/api/agent/settles", json={"inputs": _inputs(), "items": [{"id": "i7", "text": "The schedule omits the trainer rota."}], "statements": []})
    assert res.json() == {"settled": []} and mock.generate_json.await_count == 0
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/settles", json={"inputs": _inputs(), "items": [{"id": "i5", "text": FINDING, "note": NOTE}], "statements": []})
    assert res.status_code == 200 and res.json() == {"settled": []}


def test_the_mock_settles_a_note_that_begins_answer_and_nothing_else():
    req = _req(items=[
        OpenItem(id="i5", stage="Check", text="Confirm absences.", note="Answer: there are no absences this week."),
        OpenItem(id="i6", stage="Check", text="Confirm the budget.", note="Will check next week."),
    ])
    system, user = build_settles_prompt(req)
    out = parse_settles(_json_reply(system, user), req)
    assert [s.id for s in out.settled] == ["i5"]
