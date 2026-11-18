"""Whether a version proposes any new commitment (18 Nov, Sean, Executive Search)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.commitments import (
    COMMITMENTS_INSTRUCTION, COMMITMENTS_MODEL, CommitmentsRequest, build_commitments_prompt, parse_commitments,
)

BRIEF = (
    "# Role brief and client instructions\n\n"
    "Role: Not supplied.\nLocation: Not supplied.\n\n"
    "## Commitments\n\nNo timeline, no fee and no number of candidates is proposed. None is assumed.\n"
)


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def test_the_prompt_carries_the_sign_off_the_supplied_material_and_the_version():
    system, user = build_commitments_prompt(CommitmentsRequest(
        criterion="I accept any new commitments this brief proposes", stage_label="Role brief", content=BRIEF, supplied="A reusable template.",
    ))
    assert system == COMMITMENTS_INSTRUCTION
    assert "I accept any new commitments this brief proposes" in user and "A reusable template." in user and "No timeline, no fee" in user


def test_none_proposed_stands_only_with_its_passage_in_the_version():
    ok = parse_commitments({"proposes": False, "quote": "No timeline, no fee and no number of candidates is proposed."}, BRIEF)
    assert ok.proposes is False and ok.quote.startswith("No timeline")
    # A passage the version does not hold, a missing one, or a reply that says it proposes: the user's.
    assert parse_commitments({"proposes": False, "quote": "Nothing new is promised anywhere."}, BRIEF).proposes is True
    assert parse_commitments({"proposes": False}, BRIEF).proposes is True
    assert parse_commitments({"proposes": True, "quote": "Role: Not supplied."}, BRIEF).proposes is True
    assert parse_commitments(None, BRIEF).proposes is True


def test_the_route_makes_one_small_call_and_never_fails_open(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"proposes": False, "quote": "None is assumed."}, {})
    body = {"criterion": "I accept any new commitments this brief proposes", "stage_label": "Role brief", "content": BRIEF}
    res = http.post("/api/agent/check-commitments", json=body)
    assert res.status_code == 200 and res.json() == {"proposes": False, "quote": "None is assumed."}
    assert mock.generate_json.await_count == 1 and mock.generate_json.await_args.kwargs["model"] == COMMITMENTS_MODEL
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/check-commitments", json=body)
    assert res.status_code == 200 and res.json()["proposes"] is True
    mock.generate_json.reset_mock(side_effect=True)
    res = http.post("/api/agent/check-commitments", json={**body, "content": "  "})
    assert res.json()["proposes"] is True and mock.generate_json.await_count == 0


def test_the_designer_gives_no_commitments_sign_off_to_a_stage_that_adds_nothing():
    from promptmaster.workflow_designer import build_workflow_prompt

    system, user = build_workflow_prompt("A reusable executive search template.", "Assess candidates against a role brief.")
    prompt = " ".join(f"{system} {user}".split())
    assert "Never give a decision to a stage whose own instruction says to add nothing beyond what the user supplied" in prompt
    assert "a reusable template whose material the user has not supplied yet" in prompt


def test_a_version_that_puts_things_forward_is_never_none_proposed():
    # 18 Nov production pass, Saturday workshop plan: the check said "none" and quoted the heading of the
    # very section that proposed seats and refreshments against the cap.
    plan = (
        "### B. Open lines (proposed, not committed)\n\n"
        "| Proposed item | Amount | Rule | Status |\n|---|---|---|---|\n"
        "| Seats beyond what the room provides | Not priced | Goes to the user if it exceeds $30. | Open |\n"
    )
    assert parse_commitments({"proposes": False, "quote": "**Open lines (proposed, not committed)**"}, plan).proposes is True
    # A quote that does not say there is none is not enough either.
    assert parse_commitments({"proposes": False, "quote": "Role: Not supplied."}, BRIEF).proposes is True
    # Sean's brief still reads as proposing none: its one "proposed" line says there is none.
    assert parse_commitments({"proposes": False, "quote": "No timeline, no fee and no number of candidates is proposed."}, BRIEF).proposes is False
