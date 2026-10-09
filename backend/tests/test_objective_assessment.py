"""Is the objective met — judged, quoted and recorded before Go may say so
(Sean, 6 Oct, email 13: "Go marked 'Objective complete' … Pausing for missing
source material is appropriate. Marking the overall objective met is not.")."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.objective_assessment import RunStep, build_assessment_prompt, parse_assessment
from promptmaster.schemas import PMInput

LOG = (
    "Research log. Success criterion: Not met.\n"
    "No Hessian or first-curvature computation was performed.\n"
    "The program should pause: the exact formulas and parameterisation are missing."
)
STEPS = [
    RunStep(action_key="draft_stage", execution_label="discussed", output="Drafted the claims."),
    RunStep(action_key="derive", execution_label="discussed", output="Sketched the variation."),
    RunStep(action_key="run_computation", execution_label="code_executed", output="exit 0"),
]


def _inputs() -> PMInput:
    return PMInput(objective="Find whether the Regge action's Hessian is positive definite.", mode="analyst")


def test_the_prompt_says_reaching_the_last_stage_is_not_meeting_the_objective():
    system, user = build_assessment_prompt(_inputs(), "Final", LOG, STEPS, success_criterion="a supported result")
    assert "Reaching the last stage of a workflow is not meeting" in system
    assert "Hessian" in user and "SUCCESS CRITERION" in user
    assert "- S3: run_computation — code_executed" in user


def test_met_without_a_verbatim_quote_is_only_partly():
    a = parse_assessment({"outcome": "met", "basis_quote": "The Hessian is positive definite."}, LOG, STEPS)
    assert a.outcome == "partly" and a.basis_quote == ""


def test_not_met_keeps_blockers_and_quote():
    a = parse_assessment({
        "outcome": "not_met", "reason": "The log says so.",
        "basis_quote": "Success criterion: Not met.",
        "blockers": [{"need": "the exact formulas", "kind": "source_missing"}, {"need": "", "kind": "x"}],
    }, LOG, STEPS)
    assert a.outcome == "not_met"
    assert a.basis_quote == "Success criterion: Not met."
    assert [(b.need, b.kind) for b in a.blockers] == [("the exact formulas", "source_missing")]


def test_performed_names_only_recorded_steps_that_did_something():
    a = parse_assessment({
        "outcome": "not_met", "basis_quote": "",
        "performed": ["S1", "S3", "S9", "Computed the Hessian"],
        "proposed_next": ["Compute the curvature"],
    }, LOG, STEPS)
    # S1 was only discussed and S9 does not exist: neither is performed work.
    # A free-text claim of work the record does not show is at most a proposal.
    assert a.performed == ["run_computation (code_executed)"]
    assert a.proposed_next == ["Computed the Hessian", "Compute the curvature"]


def test_a_met_outcome_carries_no_blockers():
    a = parse_assessment({"outcome": "met", "basis_quote": "Research log.", "blockers": [{"need": "x"}]}, LOG, STEPS)
    assert a.outcome == "met" and a.blockers == []


def test_endpoint_returns_the_judgment_and_never_writes():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({
        "outcome": "not_met", "reason": "r", "basis_quote": "Success criterion: Not met.",
        "blockers": [{"need": "the formulas", "kind": "source_missing"}], "performed": [], "proposed_next": [],
    }, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/agent/assess-objective", json={
            "inputs": _inputs().model_dump(), "deliverable_label": "Final", "content": LOG,
            "steps": [s.model_dump() for s in STEPS],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["outcome"] == "not_met" and body["blockers"][0]["kind"] == "source_missing"
        assert "Hessian" in stub.generate_json.call_args.kwargs["prompt"]
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_a_failed_check_keeps_the_objective_from_being_met(basic_inputs):
    """C2 (Sean, 6 Oct, sequence test): the final review's findings were
    carried forward and Go still declared the objective met."""
    from promptmaster.objective_assessment import build_assessment_prompt, parse_assessment

    checks = ["Final review: carried forward — the induction proofs are missing from the report"]
    _system, user = build_assessment_prompt(basic_inputs, "Report", "The proofs are complete.", [], "", checks)
    assert "STILL UNMET" in user and "the induction proofs are missing from the report" in user
    a = parse_assessment({"outcome": "met", "basis_quote": "The proofs are complete.", "reason": "ok"}, "The proofs are complete.", [], checks)
    assert a.outcome == "partly"
    assert a.reason.startswith("Still unmet:")
def test_a_requirement_about_how_the_work_is_done_is_met_by_the_record(basic_inputs):
    """8 Oct production pass (TaskBoard): "stop and ask me first" was asked and
    answered; the check said the objective was not met because a draft exists."""
    from promptmaster.objective_assessment import build_assessment_prompt

    system, _user = build_assessment_prompt(basic_inputs, "Output", "TaskBoard launches December 10.", [])
    assert "a decision the user recorded answers the question it required" in system
