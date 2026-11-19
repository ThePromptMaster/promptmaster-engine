"""Which reserved approvals the user's own words hand to Go (19 Nov, Sean, Equipment Replacement)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.delegated_approvals import (
    DELEGATED_INSTRUCTION, DELEGATED_MODEL, ApprovalDelegatedRequest, build_delegated_prompt, parse_delegated,
)
from promptmaster.schemas import PMInput

BRIEF = (
    "Handle routine drafting, arithmetic, checking, and revisions autonomously. "
    "Keep warranty verification and actual purchase authorization pending."
)


def _req(**over) -> ApprovalDelegatedRequest:
    return ApprovalDelegatedRequest(
        inputs=PMInput(objective="Recommend a replacement vendor.", constraints=BRIEF, mode="architect",
                       facts=[{"statement": "Assumed: Vendor A is preferred.", "kind": "fact", "origin": "model_assumed"}]),
        approvals=[
            {"id": "recommendation.approved", "label": "I choose the vendor to recommend", "stage_label": "Recommendation"},
            {"id": "costs.approved", "label": "I authorize the purchase from the chosen vendor", "stage_label": "Costs"},
        ],
        delegation=[BRIEF],
        **over,
    )


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def test_the_prompt_reads_the_users_words_and_nothing_a_model_wrote():
    system, user = build_delegated_prompt(_req())
    assert system == DELEGATED_INSTRUCTION
    assert "Keep warranty verification and actual purchase authorization pending." in user
    assert "id recommendation.approved (Recommendation): I choose the vendor to recommend" in user
    assert "Assumed: Vendor A is preferred." not in user


def test_a_hand_over_stands_only_with_the_users_sentence_and_never_for_an_authorisation():
    req = _req()
    out = parse_delegated({"approvals": [
        {"id": "recommendation.approved", "hands_over": True, "quote": "Keep warranty verification and actual purchase authorization pending."},
        {"id": "costs.approved", "hands_over": True, "quote": "Handle routine drafting, arithmetic, checking, and revisions autonomously."},
    ]}, req)
    assert [(a.id, a.quote[:4]) for a in out.approvals] == [("recommendation.approved", "Keep")]
    # A sentence the user never wrote, an id that was not sent, or a no: nothing handed over.
    assert parse_delegated({"approvals": [{"id": "recommendation.approved", "hands_over": True, "quote": "You may choose the vendor."}]}, req).approvals == []
    assert parse_delegated({"approvals": [{"id": "final.approved", "hands_over": True, "quote": BRIEF}]}, req).approvals == []
    assert parse_delegated({"approvals": [{"id": "recommendation.approved", "hands_over": False, "quote": BRIEF}]}, req).approvals == []
    assert parse_delegated(None, req).approvals == []


def test_the_route_sends_only_what_may_be_handed_over_and_never_fails_open(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"approvals": [{"id": "recommendation.approved", "hands_over": True, "quote": BRIEF[:60]}]}, {})
    body = _req().model_dump()
    res = http.post("/api/agent/approval-delegated", json=body)
    assert res.status_code == 200 and res.json()["approvals"][0]["id"] == "recommendation.approved"
    kwargs = mock.generate_json.await_args.kwargs
    assert kwargs["model"] == DELEGATED_MODEL
    assert "I authorize the purchase" not in kwargs["prompt"]
    mock.generate_json.side_effect = RuntimeError("upstream down")
    assert http.post("/api/agent/approval-delegated", json=body).json() == {"approvals": []}
