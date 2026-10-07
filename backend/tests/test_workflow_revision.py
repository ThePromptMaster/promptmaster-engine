"""Changing one stage of a designed workflow without regenerating the rest,
and saying what cannot be done (Sean, 6 Oct, email 11); finite vs ongoing work
and the success criterion kept from the objective (email 10)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.workflow_designer import DesignedStage, DesignedWorkflow, build_workflow_prompt, parse_workflow
from promptmaster.workflow_revision import apply_operations, build_revision_prompt


def _s(label, kind="write", **kw):
    return DesignedStage(label=label, short_label=label[:10], kind=kind, purpose=f"{label} purpose",
                         instruction=f"{label}: an instruction the user wrote carefully.", **kw)


DESIGN = DesignedWorkflow(name="Regge study", stages=[_s("Objective"), _s("Claims", "list"), _s("Analysis"), _s("Final")])


def test_adding_a_stage_leaves_every_other_stage_exactly_as_it_was():
    out = apply_operations(DESIGN, {"operations": [{"op": "add_stage", "after": 3, "stage": {
        "label": "Verification", "kind": "check", "purpose": "p", "instruction": "Check each claim."}}]})
    assert [s.label for s in out.workflow.stages] == ["Objective", "Claims", "Analysis", "Verification", "Final"]
    for before in DESIGN.stages:
        after = next(s for s in out.workflow.stages if s.label == before.label)
        assert after.model_dump() == before.model_dump()
    assert out.changes == ["Added “Verification” after “Analysis”"]


def test_an_edit_changes_only_the_fields_it_names():
    out = apply_operations(DESIGN, {"operations": [{"op": "edit_stage", "stage": 3, "fields": {"instruction": "Compute the Hessian.", "bogus": "x"}}]})
    analysis = out.workflow.stages[2]
    assert analysis.instruction == "Compute the Hessian."
    assert analysis.purpose == "Analysis purpose" and analysis.label == "Analysis"
    assert [s.model_dump() for i, s in enumerate(out.workflow.stages) if i != 2] == [s.model_dump() for i, s in enumerate(DESIGN.stages) if i != 2]


def test_what_the_engine_cannot_do_is_said_not_approximated():
    out = apply_operations(DESIGN, {"operations": [{"op": "edit_stage", "stage": 3, "fields": {"loop_back_to": "Claims"}}],
                                    "unsupported": [{"request": "Run the claims in parallel", "reason": "Stages run in one order."}]})
    reasons = {u.request: u.reason for u in out.unsupported}
    assert reasons["Run the claims in parallel"] == "Stages run in one order."
    # A loop on a finite workflow is not kept, and that is said.
    assert out.workflow.stages[2].loop_back_to == ""
    assert "A repeating round" in reasons


def test_a_check_stage_cannot_be_put_last():
    with pytest.raises(ValueError):
        apply_operations(DESIGN, {"operations": [{"op": "add_stage", "after": 4, "stage": {"label": "Audit", "kind": "check", "instruction": "x"}}]})


def test_the_prompt_lists_what_a_workflow_can_and_cannot_do():
    system, user = build_revision_prompt(DESIGN, "add a verification stage")
    assert "WHAT IT CANNOT DO" in system and "parallel" in system and "a schedule" in system
    assert "Return OPERATIONS, not a new workflow" in system
    assert "THE USER ASKS: add a verification stage" in user


def test_the_designer_keeps_the_objectives_success_criterion_and_says_whether_work_goes_on():
    _, user = build_workflow_prompt("research", "Continue until a supported result, exhausted branches or a concrete blocker")
    assert "copy it in the user's own words; never weaken or paraphrase it" in user
    assert "Reaching the last stage is NOT the criterion" in user
    wf = parse_workflow({"name": "R", "execution": {"kind": "ongoing", "success_criterion": "a supported result", "stop_conditions": ["a blocker"]},
                         "stages": [{"label": "Objective", "kind": "write"}, {"label": "Investigate", "kind": "write"},
                                    {"label": "Next round", "kind": "write", "loop_back_to": "Investigate"},
                                    {"label": "Log", "kind": "write", "loop_back_to": "Objective"}]})
    assert wf.execution.kind == "ongoing" and wf.execution.success_criterion == "a supported result"
    # One loop, from the stage before the last, to an earlier stage.
    assert [s.loop_back_to for s in wf.stages] == ["", "", "Investigate", ""]


def test_revise_endpoint_applies_operations_and_reports_unsupported():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"operations": [{"op": "remove_stage", "stage": 2}],
                                                  "unsupported": [{"request": "email the board", "reason": "PromptMaster acts only inside the project."}]}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/revise-workflow", json={"workflow": DESIGN.model_dump(), "request": "drop the claims; email the board"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert [s["label"] for s in body["workflow"]["stages"]] == ["Objective", "Analysis", "Final"]
        assert body["unsupported"][0]["request"] == "email the board"
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_the_planner_is_told_the_execution_objective():
    from promptmaster.agent import AgentState, AgentWorkflow, AgentWorkflowStage, WorkflowExecution, build_next_action_prompt
    from promptmaster.schemas import PMInput

    state = AgentState(stage_id="log", workflow=AgentWorkflow(
        key="custom_x", label="Open research", stages=[AgentWorkflowStage(label="Log", renderer="prose")], inquiry=True,
        execution=WorkflowExecution(kind="ongoing", success_criterion="a supported result", stop_conditions=["a concrete blocker"]),
    ))
    text = "\n".join(build_next_action_prompt(PMInput(objective="Regge Hessian", mode="analyst"), state, ["declare_objective_complete"], "autonomous"))
    assert "EXECUTION: ongoing" in text
    assert "Done means: a supported result." in text
    assert "Reaching the last stage does not by itself meet the objective." in text
