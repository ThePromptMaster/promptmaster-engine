"""The scripted client that Playwright runs against (PM_LLM_MODE=mock).

These drive the real routers with ScriptedClient injected, so every parser
downstream of the mock proves the scripted shapes are valid — the mock cannot
drift from what the endpoints accept without failing here first.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import deps
from deps import get_client
from main import app
from promptmaster.llm_client import OpenRouterError
from promptmaster.mock_llm import MOCK_MODEL, ScriptedClient

INPUTS = {"objective": "A short guide to structured prompting", "audience": "Analysts", "mode": "architect"}
STAGE = {"id": "objective", "label": "Objective", "renderer": "prose"}


@pytest.fixture
def http():
    app.dependency_overrides[get_client] = lambda: ScriptedClient()
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_client, None)


# --- the production guard ----------------------------------------------------


def test_mock_mode_refuses_production(monkeypatch):
    monkeypatch.setenv("PM_LLM_MODE", "mock")
    monkeypatch.setenv("VERCEL_ENV", "production")
    with pytest.raises(RuntimeError, match="not allowed"):
        deps.llm_mode()


def test_mock_mode_off_by_default(monkeypatch):
    monkeypatch.delenv("PM_LLM_MODE", raising=False)
    assert deps.llm_mode() == "live"


def test_mock_mode_builds_the_scripted_client(monkeypatch):
    monkeypatch.setenv("PM_LLM_MODE", "mock")
    monkeypatch.delenv("VERCEL_ENV", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)  # needs no key
    assert isinstance(deps._build_client(), ScriptedClient)


# --- every call site the E2E suite reaches returns something its parser accepts


def test_prose_stage(http):
    r = http.post("/api/generate-stage-artifact", json={"inputs": INPUTS, "stage": STAGE})
    assert r.status_code == 200
    assert "Mock output" in r.json()["content"]
    assert r.json()["model_used"] == MOCK_MODEL


def test_list_stage_fills_the_schema_fields(http):
    r = http.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": INPUTS,
            "stage": {"id": "audience", "label": "Audience", "renderer": "list"},
            "item_schema": {"fields": [{"key": "who", "label": "Who"}, {"key": "need", "label": "Need"}]},
        },
    )
    items = r.json()["items"]
    assert len(items) == 3
    assert set(items[0]) >= {"id", "who", "need"}


def test_stage_evaluation_scores_a_clean_pass(http):
    r = http.post(
        "/api/evaluate-stage-artifact",
        json={"inputs": INPUTS, "stage": STAGE, "content": "Some artifact."},
    )
    evaluation = r.json()["evaluation"]
    assert (evaluation["alignment"]["score"], evaluation["clarity"]["score"], evaluation["drift"]["score"]) == (
        "High", "High", "Low",
    )


def test_setup_suggestion(http):
    r = http.post("/api/generate-setup", json={"objective": "Write a book about giraffes"})
    assert r.status_code == 200
    suggestion = r.json()["suggestion"]
    assert suggestion["mode"] == "architect"
    assert "giraffes" in suggestion["constraints"]


def test_outline(http):
    r = http.post("/api/generate-outline", json={"inputs": INPUTS, "suggested_section_count": 4})
    assert r.status_code == 200
    assert [s["title"] for s in r.json()["outline"]] == [f"Mock section {n}" for n in range(1, 5)]


# --- fault injection -----------------------------------------------------------


@pytest.mark.asyncio
async def test_402_marker_raises_a_non_retryable_credit_error():
    with pytest.raises(OpenRouterError) as err:
        await ScriptedClient().generate("Objective: x [[mock:402]]")
    assert err.value.status_code == 402


@pytest.mark.asyncio
async def test_length_marker_reports_truncation():
    _content, _usage, finish = await ScriptedClient().generate_with_meta("go [[mock:length]]")
    assert finish == "length"


def test_402_reaches_the_user_as_a_structured_error(http):
    """The drain parses `detail.code` to decide not to retry (PM-04)."""
    inputs = {**INPUTS, "objective": "Credits test [[mock:402]]"}
    r = http.post("/api/generate-stage-artifact", json={"inputs": inputs, "stage": STAGE})
    assert r.status_code >= 400
    assert isinstance(r.json()["detail"], dict)
