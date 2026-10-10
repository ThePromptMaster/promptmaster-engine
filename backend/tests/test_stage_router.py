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


def test_model_used_is_the_one_the_call_ran_on(client_with):
    """FR-10: a project that never picked a model must still get a version
    attributed to the model that wrote it, not an empty string."""
    stub = AsyncMock()
    stub.model = "provider/default-model"
    stub.generate_with_meta = AsyncMock(return_value=("Drafted.", {}, "stop"))
    client = client_with(stub)
    stage = {"id": "positioning", "label": "Positioning", "renderer": "prose"}

    defaulted = client.post(
        "/api/generate-stage-artifact",
        json={"inputs": INPUTS, "stage": stage, "digest": DIGEST},
    )
    chosen = client.post(
        "/api/generate-stage-artifact",
        json={"inputs": INPUTS, "stage": stage, "digest": DIGEST, "model": "provider/picked"},
    )
    assert defaulted.json()["model_used"] == "provider/default-model"
    assert chosen.json()["model_used"] == "provider/picked"


REVIEW_STAGE = {
    "inputs": INPUTS,
    "stage": {"id": "summary", "label": "Final review", "renderer": "review"},
    "digest": DIGEST,
    "item_schema": {"item_label": "finding", "fields": [{"key": "finding", "label": "Finding"}]},
}


def test_a_review_stage_out_of_credits_says_so(client_with):
    """10 Oct, prod: a 402 on Final review read as "the draft came back empty"."""
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=OpenRouterError(
        "HTTP 402: would exceed your available credits", status_code=402, provider_code=None,
    ))
    r = client_with(stub).post("/api/generate-stage-artifact", json=REVIEW_STAGE)
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "insufficient_credits"


def test_an_unparseable_table_is_still_an_empty_editable_stage(client_with):
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=ValueError("could not parse JSON after repair"))
    r = client_with(stub).post("/api/generate-stage-artifact", json=REVIEW_STAGE)
    assert r.status_code == 200
    assert r.json()["items"] == [] and r.json()["finish_reason"] == "error"
