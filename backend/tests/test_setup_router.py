"""Smoke tests for the Smart Setup router."""

import inspect

from routers import setup as setup_router_module


def test_generate_setup_request_has_required_fields():
    fields = setup_router_module.GenerateSetupRequest.model_fields
    for required in ("objective", "model"):
        assert required in fields, f"missing field: {required}"


def test_generate_setup_response_has_suggestion_envelope():
    fields = setup_router_module.GenerateSetupResponse.model_fields
    assert "suggestion" in fields


def test_router_registers_endpoint():
    paths = [r.path for r in setup_router_module.router.routes]
    assert "/api/generate-setup" in paths


def test_endpoint_calls_suggest_setup():
    src = inspect.getsource(setup_router_module.api_generate_setup)
    assert "suggest_setup" in src


from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_client


@pytest.mark.asyncio
async def test_generate_setup_end_to_end_with_mocked_llm():
    """Full request -> endpoint -> suggest_setup -> response, with mocked LLM client.

    Proves the wiring is correct: the endpoint successfully invokes suggest_setup
    with the user's objective, the response envelope shape is { suggestion: {...} },
    and defensive parsing produces a usable result for a typical LLM response.
    """
    fake_llm_response = {
        "mode": "architect",
        "audience": "Engineering Leads",
        "constraints": "Two-week timeline",
        "output_format": "Numbered list",
        "rationale": {
            "mode": "Best for structured plans",
            "audience": "Matches the framing",
            "constraints": "Adds a deadline",
            "output_format": "Scannable structure",
        },
    }
    fake_client = AsyncMock()
    fake_client.generate_json = AsyncMock(return_value=(fake_llm_response, {}))

    app.dependency_overrides[get_client] = lambda: fake_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/generate-setup",
            json={"objective": "Plan a launch strategy for an internal tool", "model": ""},
        )
        assert response.status_code == 200
        body = response.json()
        assert "suggestion" in body
        suggestion = body["suggestion"]
        assert suggestion["mode"] == "architect"
        assert suggestion["audience"] == "Engineering Leads"
        assert suggestion["constraints"] == "Two-week timeline"
        assert suggestion["output_format"] == "Numbered list"
        assert suggestion["rationale"]["mode"] == "Best for structured plans"
        # The LLM was actually called once with the objective in its prompt
        fake_client.generate_json.assert_called_once()
        call_kwargs = fake_client.generate_json.call_args.kwargs
        assert "Plan a launch strategy" in call_kwargs.get("prompt", "")
    finally:
        app.dependency_overrides.clear()


def test_generate_setup_falls_back_to_architect_for_invalid_mode_end_to_end():
    """When the LLM returns an invalid mode, the endpoint still returns architect."""
    fake_llm_response = {
        "mode": "bogus_mode",
        "audience": "General",
        "constraints": "",
        "output_format": "",
        "rationale": {},
    }
    fake_client = AsyncMock()
    fake_client.generate_json = AsyncMock(return_value=(fake_llm_response, {}))

    app.dependency_overrides[get_client] = lambda: fake_client
    try:
        client = TestClient(app)
        response = client.post(
            "/api/generate-setup",
            json={"objective": "x", "model": ""},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["suggestion"]["mode"] == "architect"  # fallback worked
    finally:
        app.dependency_overrides.clear()


def test_generate_setup_passes_guided_answers_through():
    from unittest.mock import AsyncMock as _AsyncMock
    from fastapi.testclient import TestClient as _TestClient
    from deps import get_client as _get_client
    from main import app as _app

    client = _AsyncMock()
    client.generate_json = _AsyncMock(return_value=({"mode": "coach", "workflow": "book"}, {}))
    _app.dependency_overrides[_get_client] = lambda: client
    try:
        r = _TestClient(_app).post("/api/generate-setup", json={
            "objective": "A book about giraffes",
            "answers": [{"question": "Who is this for?", "answer": "Ten-year-olds"}],
        })
    finally:
        _app.dependency_overrides.pop(_get_client, None)
    assert r.status_code == 200
    assert r.json()["suggestion"]["workflow"] == "book"
    assert "Ten-year-olds" in client.generate_json.await_args.kwargs["prompt"]


def test_guide_questions_endpoint():
    from unittest.mock import AsyncMock as _AsyncMock
    from fastapi.testclient import TestClient as _TestClient
    from deps import get_client as _get_client
    from main import app as _app

    client = _AsyncMock()
    client.generate_json = _AsyncMock(return_value=({"questions": [
        {"id": "q1", "question": "Who is this for?", "why": "Tone.", "options": ["Kids"]}
    ]}, {}))
    _app.dependency_overrides[_get_client] = lambda: client
    try:
        r = _TestClient(_app).post("/api/guide-questions", json={"objective": "A book about giraffes"})
    finally:
        _app.dependency_overrides.pop(_get_client, None)
    assert r.status_code == 200
    assert r.json()["questions"][0]["question"] == "Who is this for?"
    assert "A book about giraffes" in client.generate_json.await_args.kwargs["prompt"]
