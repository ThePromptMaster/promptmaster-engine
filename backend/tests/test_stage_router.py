"""/api/generate-stage-artifact wiring."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.llm_client import OpenRouterError

INPUTS = {
    "objective": "A field guide to governing AI-assisted work.",
    "audience": "Engineering leads",
    "mode": "architect",
}

DIGEST = {
    "objective": "A field guide to governing AI-assisted work.",
    "audience": "Engineering leads",
    "prior_stages": [
        {"stage_id": "objective", "label": "Objective", "summary": "Govern AI-written work."}
    ],
}


@pytest.fixture
def client_with(monkeypatch):
    def _install(stub):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app, raise_server_exceptions=False)

    yield _install
    app.dependency_overrides.pop(get_client, None)


def test_prose_stage_round_trip(client_with):
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(return_value=("Drafted positioning.", {}, "stop"))
    client = client_with(stub)

    r = client.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": INPUTS,
            "stage": {
                "id": "positioning",
                "label": "Positioning",
                "renderer": "prose",
                "entry_prompt_hint": "Name the comparables.",
            },
            "digest": DIGEST,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "Drafted positioning."
    assert body["items"] == []

    # The authored instruction and the digest reached the model, not just the app.
    system = stub.generate_with_meta.await_args.kwargs["system"]
    user = stub.generate_with_meta.await_args.kwargs["prompt"]
    assert "Name the comparables." in system
    assert "Govern AI-written work." in user


def test_list_stage_round_trip(client_with):
    stub = AsyncMock()
    stub.generate_json = AsyncMock(
        return_value=({"items": [{"id": "a1", "who": "Engineering leads"}]}, {})
    )
    client = client_with(stub)

    r = client.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": INPUTS,
            "stage": {"id": "audience", "label": "Audience", "renderer": "list"},
            "digest": DIGEST,
            "item_schema": {
                "item_label": "audience segment",
                "fields": [{"key": "who", "label": "Who this segment is"}],
            },
        },
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert items == [{"id": "a1", "who": "Engineering leads"}]


def test_llm_failure_surfaces_as_502(client_with):
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(side_effect=OpenRouterError("upstream down"))
    client = client_with(stub)

    r = client.post(
        "/api/generate-stage-artifact",
        json={
            "inputs": INPUTS,
            "stage": {"id": "positioning", "renderer": "prose"},
            "digest": DIGEST,
        },
    )
    assert r.status_code == 502


def test_digest_is_optional(client_with):
    """A first stage has nothing before it; that must not be a 422."""
    stub = AsyncMock()
    stub.generate_with_meta = AsyncMock(return_value=("Text.", {}, "stop"))
    client = client_with(stub)

    r = client.post(
        "/api/generate-stage-artifact",
        json={"inputs": INPUTS, "stage": {"id": "objective", "renderer": "prose"}},
    )
    assert r.status_code == 200
