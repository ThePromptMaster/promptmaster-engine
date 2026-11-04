"""The check a delegated commit must pass (Sean, 5 Oct)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.criterion_check import MAX_CHECK_CONTENT, build_check_prompt, parse_check


def test_the_prompt_judges_only_the_statement_from_the_text(basic_inputs):
    system, user = build_check_prompt(basic_inputs, "Objective", "I am satisfied it says what success looks like", "Success is 40 schools by June.")
    assert "Judge ONLY whether the stage's text" in system
    assert "assumption" in system
    assert '"I am satisfied it says what success looks like"' in user
    assert "Success is 40 schools by June." in user


def test_a_long_stage_is_cut_and_says_so(basic_inputs):
    _, user = build_check_prompt(basic_inputs, "S", "c", "x" * (MAX_CHECK_CONTENT * 2))
    stage_text = user.split("--- THE STAGE'S TEXT ---")[1].split("--- END ---")[0]
    assert stage_text.count("x") <= MAX_CHECK_CONTENT + 2
    assert "not shown" in user


def test_only_an_explicit_true_is_met():
    assert parse_check({"met": True, "reason": "It says so."}).met is True
    assert parse_check({"met": "yes", "reason": "?"}).met is False
    assert parse_check({}).met is False
    assert parse_check(None).met is False


def test_the_route_returns_the_verdict(basic_inputs):
    client = AsyncMock()
    client.generate_json.return_value = ({"met": False, "reason": "No scope is stated."}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/agent/check-criterion", json={
            "inputs": basic_inputs.model_dump(), "stage_label": "Objective",
            "criterion": "I am satisfied it says what is out of scope", "content": "A book about giraffes.",
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json()["met"] is False and res.json()["reason"] == "No scope is stated."


def test_the_check_is_given_the_projects_setup_as_settled(basic_inputs):
    """4 Nov (production pass, Sean's support-software prompt): the brief's
    "Audience: Executive" — the setup's own audience — was judged invented,
    because the check was never shown the setup; Go revised twice and stopped."""
    inputs = basic_inputs.model_copy(update={"audience": "Executive", "constraints": "Under 500 words.", "output_format": "Decision memo"})
    _, user = build_check_prompt(inputs, "Brief", "I approve this brief as the basis for the memo.", "Audience: Executive")
    assert "THE PROJECT'S SETUP (settled in the project; text that follows it is not invented" in user
    assert "Audience: Executive" in user.split("--- THE STAGE'S TEXT ---")[0]
    assert "Constraints: Under 500 words." in user and "Output format: Decision memo" in user
