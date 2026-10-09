"""A workflow designed for work the built-in ones do not fit (3 Oct call)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.workflow_designer import build_workflow_prompt, parse_workflow


def _stage(label, kind="write", **kw):
    return {"label": label, "short_label": label[:10], "kind": kind, "purpose": "p", "instruction": "i", **kw}


def test_the_prompt_offers_only_existing_page_kinds_and_names_the_work():
    system, user = build_workflow_prompt("a magazine feature", "Profile a chef")
    assert "THE KIND OF WORK: a magazine feature" in user
    assert '"write"' in user and '"list"' in user and '"check"' in user
    assert "chapters" not in user
    assert "HOW PROMPTMASTER WORKS" in system


def test_unknown_kinds_are_dropped_a_check_cannot_open_and_a_closing_check_gets_finalise():
    wf = parse_workflow({"name": "X", "stages": [
        _stage("Audit", "check"), _stage("Brief"), _stage("Bogus", "video"), _stage("Draft"),
        _stage("Review", "check"), _stage("Final", required=False), _stage("Late check", "check"),
    ]})
    # 9 Oct (Sean's email 14): a final verification was silently dropped; it
    # is kept, followed by the stage that produces the finished work.
    assert [s.label for s in wf.stages] == ["Brief", "Draft", "Review", "Final", "Late check", "Finalise"]
    assert wf.stages[-1].required is True and wf.stages[-1].kind == "write"


def test_too_few_stages_is_refused():
    with pytest.raises(ValueError):
        parse_workflow({"stages": [_stage("One"), _stage("Two")]})


def test_endpoint_returns_the_design_and_refuses_an_unusable_one():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"name": "Feature", "stages": [_stage("A"), _stage("B"), _stage("C")]}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        client = TestClient(app)
        r = client.post("/api/generate-workflow", json={"description": "a magazine feature"})
        assert r.status_code == 200, r.text
        assert [s["label"] for s in r.json()["workflow"]["stages"]] == ["A", "B", "C"]
        assert "a magazine feature" in stub.generate_json.call_args.kwargs["prompt"]

        stub.generate_json = AsyncMock(return_value=({"stages": []}, {}))
        assert client.post("/api/generate-workflow", json={"description": "a magazine feature"}).status_code == 422
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_each_approval_says_whether_it_is_routine_and_new_commitments_are_kept_apart():
    """Sean, 5 Oct: "I approve these extracted claims and commitments" stopped
    Autonomous. Checking what the source says is routine; accepting a new
    commitment is the user's."""
    _, user = build_workflow_prompt("contract review", "Summarise the supplier terms")
    assert "approval_kind" in user and "routine" in user
    assert "new commitments" in user

    wf = parse_workflow({"name": "X", "stages": [
        _stage("Brief"),
        _stage("Extract terms", "list", approval="I confirm the extracted terms match the contract",
               approval_kind="routine", decision="I accept the new commitments it proposes"),
        _stage("Recommend", approval="I approve this recommendation", approval_kind="whatever"),
        _stage("Final"),
    ]})
    extract, recommend = wf.stages[1], wf.stages[2]
    assert extract.approval_kind == "routine"
    assert extract.decision == "I accept the new commitments it proposes"
    # Anything but an explicit "routine" stays the user's.
    assert recommend.approval_kind == "decision"
