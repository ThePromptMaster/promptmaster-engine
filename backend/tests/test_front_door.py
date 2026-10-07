"""The conversational front door (Sean, 6 Oct, email 8): one question at a
time, a visible draft brief, and nothing in it the user did not say."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.front_door import DraftBrief, Turn, build_front_door_prompt, parse_front_door

TURNS = [Turn(role="user", content="Choose one project within 160 staff hours. B needs 120 hours and returns $45,000."),
         Turn(role="assistant", content="Who decides?"), Turn(role="user", content="The board. One researcher must stay free.")]


def test_the_prompt_asks_one_question_and_keeps_only_what_the_user_said():
    system, user = build_front_door_prompt(TURNS, DraftBrief())
    assert "at most ONE useful question" in system
    assert "Never put in the brief anything the user did not say" in system
    assert "Nothing is saved until the user confirms" in system
    assert "USER: The board. One researcher must stay free." in user


def test_a_figure_the_user_never_gave_is_dropped_from_the_brief():
    out = parse_front_door({"reply": "ok", "ready": True, "brief": {
        "objective": "Choose one project", "evidence": ["B needs 120 hours and returns $45,000", "A returns $60,000"],
        "requirements": ["One researcher must stay free", "Stay under 200 hours"]}}, TURNS)
    assert out.brief.evidence == ["B needs 120 hours and returns $45,000"]
    assert out.brief.requirements == ["One researcher must stay free"]
    assert out.ready is True
    # Not ready without an objective.
    assert parse_front_door({"reply": "x", "ready": True, "brief": {}}, TURNS).ready is False


def test_endpoint_returns_reply_and_brief_and_saves_nothing():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"reply": "Who is it for?", "brief": {"objective": "o"}, "ready": False}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/front-door", json={"turns": [t.model_dump() for t in TURNS]})
        assert r.status_code == 200, r.text
        assert r.json()["reply"] == "Who is it for?" and r.json()["brief"]["objective"] == "o"
    finally:
        app.dependency_overrides.pop(get_client, None)
