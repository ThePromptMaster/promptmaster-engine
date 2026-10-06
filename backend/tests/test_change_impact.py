"""What a change to the brief reopens (Sean, 5 Oct acceptance tests 4-6)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.change_impact import StageConclusion, build_impact_prompt, parse_impact

STAGES = [
    StageConclusion(stage_id="analysis", label="Analysis", summary="Margin fell 6.4 points.", figures=["31.2%", "24.8%"], computed=True),
    StageConclusion(stage_id="recommend", label="Recommendations", summary="Invest in automation, since funding is secured."),
]


def test_the_prompt_carries_the_change_and_what_each_stage_concluded():
    system, user = build_impact_prompt("context", "Funding is secured.", "Funding is pending.", STAGES)
    assert "ONLY the stages whose conclusions relied on what changed" in system
    assert "numbers worked out from data usually still hold" in system
    assert "--- BEFORE ---\nFunding is secured." in user and "--- AFTER ---\nFunding is pending." in user
    assert "id=analysis — Analysis (computed from data): Margin fell 6.4 points. Figures: 31.2%; 24.8%." in user


def test_invented_and_repeated_stages_are_dropped_and_wording_reopens_nothing():
    out = parse_impact({"kind": "fact", "affected": [
        {"stage_id": "recommend", "reason": "Relied on secured funding."},
        {"stage_id": "recommend", "reason": "again"},
        {"stage_id": "invented", "reason": "x"},
    ]}, {"analysis", "recommend"})
    assert [a.stage_id for a in out.affected] == ["recommend"]
    assert out.affected[0].reason == "Relied on secured funding."
    assert parse_impact({"kind": "wording", "affected": [{"stage_id": "recommend"}]}, {"recommend"}).affected == []
    assert parse_impact(None, set()).affected == []


def test_the_route_returns_the_impact():
    client = AsyncMock()
    client.generate_json.return_value = ({"kind": "intent", "affected": [{"stage_id": "recommend", "reason": "Judged against margin."}], "calculations_hold": True}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/assess-change", json={
            "field": "objective", "before": "Maximise margin", "after": "Preserve headcount",
            "stages": [s.model_dump() for s in STAGES],
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json() == {"kind": "intent", "affected": [{"stage_id": "recommend", "reason": "Judged against margin."}], "calculations_hold": True}


def test_only_brief_fields_can_be_assessed():
    app.dependency_overrides[get_client] = lambda: AsyncMock()
    try:
        res = TestClient(app).post("/api/assess-change", json={"field": "title", "before": "a", "after": "b"})
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 422
