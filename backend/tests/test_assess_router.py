"""/api/assess-batch: a pasted batch judged against the criteria, on the user's scale (25 Oct)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.assessment import AssessScale, build_assess_prompt, parse_assessment
from promptmaster.schemas import PMInput, StageDigest

INPUTS = {"objective": "Screen candidates for a VP Finance search.", "audience": "Search partners", "mode": "architect"}
DIGEST = {
    "objective": "Screen candidates for a VP Finance search.",
    "prior_stages": [{"stage_id": "criteria", "label": "Criteria", "summary": "Must have: led a finance team of 20+."}],
}
TRAFFIC = {"levels": [
    {"value": "green", "label": "Screen", "meaning": "Meets every must-have."},
    {"value": "amber", "label": "Maybe", "meaning": "Meets most; one gap worth a call."},
    {"value": "red", "label": "Pass", "meaning": "Misses a must-have."},
]}


@pytest.fixture
def client_with():
    def _install(stub):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app, raise_server_exceptions=False)

    yield _install
    app.dependency_overrides.pop(get_client, None)


def test_the_prompt_carries_the_criteria_the_scale_and_the_paste():
    system, user = build_assess_prompt(
        PMInput(**INPUTS), StageDigest(**DIGEST), AssessScale(**TRAFFIC), "Jane Doe — CFO at Acme\n\nJohn Roe — Controller",
    )
    assert "Must have: led a finance team of 20+." in user
    assert '"amber" — Maybe: Meets most' in system and '"amber" — Maybe' in user
    assert "Jane Doe — CFO at Acme" in user.split("--- BEGIN PASTED ITEMS ---")[1]
    # It judges what the text says, and says what is missing rather than guessing.
    assert "Never invent" in system and "`gaps`" in system
    # Not on protected characteristics, nor their proxies.
    assert "protected characteristic" in system


def test_off_scale_verdicts_are_cleared_not_guessed():
    result = parse_assessment(
        {"items": [
            {"subject": "Jane Doe", "verdict": "Screen", "rationale": ["Led 40 people"]},
            {"subject": "John Roe", "verdict": "yellow", "rationale": "- Unclear"},
            {"subject": "", "verdict": "red", "rationale": ""},
        ]},
        AssessScale(**TRAFFIC),
    )
    assert [i.verdict for i in result.items] == ["green", ""]
    assert result.items[0].rationale == "- Led 40 people"
    assert result.ungraded == 1


def test_round_trip(client_with):
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=(
        {"items": [{"subject": "Jane Doe — CFO", "verdict": "green", "rationale": "- Led 40", "evidence": '"40 people"', "gaps": ""}], "not_assessed": 2},
        {},
    ))
    r = client_with(stub).post("/api/assess-batch", json={
        "inputs": INPUTS, "digest": DIGEST, "scale": TRAFFIC, "text": "Jane Doe — CFO at Acme. Led 40 people.",
        "already": ["John Roe — Controller"],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["items"][0]["verdict"] == "green" and body["items"][0]["id"].startswith("a_")
    assert body["not_assessed"] == 2
    assert body["web_query"] == ""
    user = stub.generate_json.await_args.kwargs["prompt"]
    assert "John Roe — Controller" in user


def test_a_scale_needs_two_levels(client_with):
    r = client_with(AsyncMock()).post("/api/assess-batch", json={
        "inputs": INPUTS, "scale": {"levels": [{"value": "ok", "label": "OK"}]}, "text": "x",
    })
    assert r.status_code == 422
