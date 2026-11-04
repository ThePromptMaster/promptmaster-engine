"""4 Nov (Sean, Lakeside proposal): a note to the user never stays in the work.

Every revision Go saved of the final proposal ended with a block addressed to
him — "Notes for you, outside the proposal:", "Reply to you, not part of the
document:" — because the writer was told to say those things "in a reply" and
had no reply. The fixtures are those endings, as saved on production, and are
shared with the browser's splitter (`frontend/src/lib/workflow/user-note.ts`).
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.reader_text import USER_NOTE_MARKER, USER_NOTE_RULE, split_user_note
from promptmaster.schemas import PMInput, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt

CASES = json.loads((Path(__file__).parent / "fixtures" / "user_notes.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_note_comes_off_and_the_work_stays_as_written(case):
    work, note = split_user_note(case["text"])
    assert work == case["document"]
    assert bool(note) is case["note"]


def test_the_note_keeps_what_it_said():
    case = next(c for c in CASES if c["name"].startswith("Lakeside final proposal v13"))
    work, note = split_user_note(case["text"])
    assert work.endswith("before any booking or payment.")
    assert "Approving the document does not authorise sending it" in note
    assert "Notes for you" in note


def test_a_text_without_a_note_is_returned_unchanged():
    assert split_user_note("") == ("", "")
    assert split_user_note("Just the answer.") == ("Just the answer.", "")


def test_a_prose_stage_is_told_where_its_note_goes():
    system, _ = build_stage_prompt(
        PMInput(objective="A client proposal", audience="An operations director", mode="architect"),
        StageDescriptor(id="final", label="Final proposal", renderer="prose"),
        StageDigest(),
    )
    assert USER_NOTE_RULE in system
    assert USER_NOTE_MARKER in system


@pytest.fixture
def client_with():
    def _install(stub):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app, raise_server_exceptions=False)

    yield _install
    app.dependency_overrides.pop(get_client, None)


def test_the_router_returns_the_note_beside_the_work(client_with):
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(return_value=(
        "## 7. Next step\n\nPlease confirm the option.\n\n&nbsp;\n\n*Outside the proposal:* Approving this "
        "document does not authorise sending it. No further drafting pass is needed unless you change a fact.",
        {},
        "stop",
    ))
    client = client_with(stub)
    r = client.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": {"objective": "A client proposal", "audience": "An operations director", "mode": "architect"},
            "stage": {"id": "final", "label": "Final proposal", "renderer": "prose"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "## 7. Next step\n\nPlease confirm the option."
    assert body["note_to_user"].startswith("*Outside the proposal:* Approving this document")


def test_a_table_is_never_split(client_with):
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"items": [{"id": "a1", "who": "Notes for you: leads"}]}, {}))
    client = client_with(stub)
    r = client.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": {"objective": "Audience segments", "audience": "Marketing", "mode": "architect"},
            "stage": {"id": "segments", "label": "Segments", "renderer": "list"},
        },
    )
    assert r.status_code == 200
    assert r.json()["note_to_user"] == ""
