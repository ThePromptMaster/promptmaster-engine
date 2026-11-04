"""A failed check on demand, for testing on production (4 Nov, Sean: "I'd also
test an empty check separately to verify that it reports the failure accurately").
Only for SIMULATE_FAILURE_USER_IDS; unset means no one."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from auth import AuthUser
from deps import get_client
from main import app

BODY = {
    "inputs": {"objective": "A memo.", "mode": "architect"},
    "stage": {"id": "final", "label": "Final memo", "renderer": "prose", "entry_prompt_hint": "Write it."},
    "content": "# Memo\nText.",
    "simulate": "empty",
}


@pytest.fixture
def stub():
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({}, {}))
    app.dependency_overrides[get_client] = lambda: client
    yield client
    app.dependency_overrides.pop(get_client, None)


def test_a_listed_user_gets_exactly_a_failed_check_and_no_model_call(stub, monkeypatch):
    # The caller is on the list (the allowlist itself is tested below).
    import routers.stage as stage_router
    monkeypatch.setattr(stage_router, "simulation_allowed", lambda user: True)
    r = TestClient(app).post("/api/evaluate-stage-artifact", json=BODY)
    assert r.status_code == 200
    ev = r.json()["evaluation"]
    assert ev["failed"] is True
    assert "No content in response (finish_reason='length')" in ev["alignment"]["explanation"]
    assert ev["findings"] == []
    stub.generate_json.assert_not_called()


def test_anyone_else_is_refused_and_unset_means_no_one(stub, monkeypatch):
    from simulation import simulation_allowed

    monkeypatch.delenv("SIMULATE_FAILURE_USER_IDS", raising=False)
    assert simulation_allowed(AuthUser(id="admin-1", email=None, role="authenticated")) is False
    monkeypatch.setenv("SIMULATE_FAILURE_USER_IDS", "admin-1, sean-2")
    assert simulation_allowed(AuthUser(id="sean-2", email=None, role="authenticated")) is True
    assert simulation_allowed(AuthUser(id="someone", email=None, role="authenticated")) is False
    assert simulation_allowed(None) is False
    r = TestClient(app).post("/api/evaluate-stage-artifact", json=BODY)
    assert r.status_code == 403
    stub.generate_json.assert_not_called()


def test_without_the_flag_the_check_runs_as_before(stub):
    r = TestClient(app).post("/api/evaluate-stage-artifact", json={**BODY, "simulate": ""})
    assert r.status_code == 200
    stub.generate_json.assert_awaited()
