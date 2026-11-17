"""17 Nov (Sean): the side chat named buttons he could not find, and a chip promised to change
another stage; the start conversation could not read his Drive or Salesforce."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import account_owner, get_client, optional_composio
from main import app
from promptmaster import front_door as fd
from promptmaster.page_context import GoRunTrace, GoStepTrace, PageButton, format_buttons, format_go_run, scrub_button_mentions
from promptmaster.reply_actions import parse_reply_actions
from promptmaster.schemas import AccountUse, ThirdPartyItem

MORE = 'under "More" at the bottom of the stage'
BUTTONS = [
    PageButton(label="Realign to the objective", where=MORE, does="rewrites the whole draft back toward the objective, as a new version"),
    PageButton(label="Continue to Final register", where=MORE),
    PageButton(label="Apply and continue", where="in the bar at the top of the stage"),
]


def test_buttons_say_where_they_are_and_what_they_do():
    block = format_buttons(BUTTONS)
    assert '- "Realign to the objective" — under "More" at the bottom of the stage — rewrites the whole draft back toward the objective' in block
    assert "say where it is" in block
    assert "Choose a button by what it does" in block


def test_a_more_button_named_without_its_place_gets_it():
    out = scrub_button_mentions('Then press "Continue to Final register".', BUTTONS)
    assert out == 'Then press "Continue to Final register" (under "More" at the bottom of the stage).'
    # Said already, or not under More: left alone.
    assert scrub_button_mentions('Press "Continue to Final register" under More.', BUTTONS) == 'Press "Continue to Final register" under More.'
    assert scrub_button_mentions('Press "Apply and continue".', BUTTONS) == 'Press "Apply and continue".'


def test_go_steps_reach_the_chat_with_their_stage_and_more_of_their_output():
    run = GoRunTrace(status="awaiting_decision", policy="autonomous", steps=[
        GoStepTrace(action="recheck_stage", status="interrupted", stage="Manuscript", output="Repaired 13 sections. " + "x" * 600 + " still being written when the wait ran out."),
    ])
    text = format_go_run(run)
    assert "- recheck_stage on Manuscript [interrupted;" in text
    assert len(text) > 700


def test_a_chip_on_this_stage_never_promises_to_change_another():
    raw = {"actions": [
        {"label": "Apply pending fixes to manuscript text", "kind": "revise", "instruction": "Apply the fixes."},
        {"label": "Remove the Chapter 5 retitle approval", "kind": "revise", "instruction": "Remove it from this register."},
    ]}
    out = parse_reply_actions(raw, None, "", None, ["Manuscript", "Adversarial review", "Final register"])
    assert [a.label for a in out] == ["Remove the Chapter 5 retitle approval"]


# The start conversation reads connected accounts.

ITEM = ThirdPartyItem(kind="file", source="Google Drive", title="Q3 board pack", text="Revenue grew 12% in Q3.", when="2 Nov")


@pytest.fixture
def start(monkeypatch):
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"reply": "Your Q3 board pack says revenue grew 12% [T1].", "brief": {"objective": "A Q3 summary"}}, {}))
    found = AsyncMock(return_value=(None, AccountUse(account_query="Q3 board pack", account_items=[ITEM])))
    monkeypatch.setattr(fd, "with_accounts", found)
    app.dependency_overrides[get_client] = lambda: stub
    app.dependency_overrides[optional_composio] = lambda: object()
    app.dependency_overrides[account_owner] = lambda: "user-1"
    yield stub, found
    app.dependency_overrides.clear()


def test_the_start_conversation_reads_the_accounts_and_returns_what_it_read(start):
    stub, found = start
    r = TestClient(app).post("/api/front-door", json={
        "turns": [{"role": "user", "content": "Summarise my Q3 board pack from Drive"}], "account_search": "on",
        "third_party": [{"kind": "email", "title": "Carried in", "text": "Secret: never shown."}],
    })
    assert r.status_code == 200, r.text
    assert found.await_count == 1
    body = r.json()
    assert body["account_items"][0]["title"] == "Q3 board pack"
    prompt = stub.generate_json.await_args.kwargs["prompt"]
    assert "Revenue grew 12% in Q3." in prompt
    assert "Never write any of it into the brief" in prompt
    # What "Start this" carried in stays titles only (7 Nov).
    assert "Carried in" in prompt and "Secret" not in prompt


def test_off_or_a_guest_reads_nothing(start):
    stub, found = start
    r = TestClient(app).post("/api/front-door", json={"turns": [{"role": "user", "content": "Summarise my Q3 board pack"}]})
    assert r.status_code == 200 and found.await_count == 0
    app.dependency_overrides[account_owner] = lambda: None
    r = TestClient(app).post("/api/front-door", json={"turns": [{"role": "user", "content": "Summarise it"}], "account_search": "on"})
    assert r.status_code == 200 and found.await_count == 0
