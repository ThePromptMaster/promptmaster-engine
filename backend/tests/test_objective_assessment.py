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
    assert a.performed == ["Run a computation (code executed)"]
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
    assert a.reason.startswith("Not met: Final review: carried forward")
    assert a.model_note == "ok"


def test_a_requirement_about_how_the_work_is_done_is_met_by_the_record(basic_inputs):
    """8 Oct production pass (TaskBoard): "stop and ask me first" was asked and
    answered; the check said the objective was not met because a draft exists."""
    from promptmaster.objective_assessment import build_assessment_prompt

    system, _user = build_assessment_prompt(basic_inputs, "Output", "TaskBoard launches December 10.", [])
    assert "a decision the user recorded answers the question it required" in system


def test_a_heading_is_not_evidence_the_objective_is_met():
    """Sean, 10 Oct, email 8: the completion message quoted "## 1. Pre-arrival preparation"."""
    plan = "## 1. Pre-arrival preparation\n\nSend the laptop request a week before day one so access works on arrival."
    a = parse_assessment({"outcome": "met", "basis_quote": "## 1. Pre-arrival preparation"}, plan, [])
    assert a.outcome == "partly" and a.basis_quote == ""
    a = parse_assessment({"outcome": "met", "basis_quote": "1. Pre-arrival preparation"}, plan, [])
    assert a.outcome == "partly"


def test_each_requirement_has_a_verdict_and_a_met_one_has_a_sentence():
    """Sean, 10 Oct, emails 3, 6.5 and 8: what was checked, and how, is on the record."""
    plan = "Send the laptop request a week before day one so access works on arrival."
    a = parse_assessment({
        "outcome": "met", "basis_quote": plan,
        "criteria": [
            {"requirement": "Covers pre-arrival", "verdict": "met", "basis": plan},
            {"requirement": "Fits on one page", "verdict": "not_checked", "basis": "Page length is not visible in the text."},
            {"requirement": "Six sections", "verdict": "met", "basis": "There are six sections."},
            {"requirement": "", "verdict": "met"},
        ],
    }, plan, [])
    assert [(c.requirement, c.verdict) for c in a.criteria] == [
        ("Covers pre-arrival", "met"), ("Fits on one page", "not_checked"), ("Six sections", "not_checked"),
    ]
    assert a.outcome == "met"


def test_a_requirement_found_unmet_keeps_the_objective_from_being_met():
    plan = "Send the laptop request a week before day one so access works on arrival."
    a = parse_assessment({
        "outcome": "met", "basis_quote": plan,
        "criteria": [{"requirement": "Labels its assumptions", "verdict": "not_met", "basis": "No assumption is labelled."}],
    }, plan, [])
    assert a.outcome == "partly"
    assert a.reason == "Not met: Labels its assumptions — No assumption is labelled."


BRIEF = (
    "## Purpose\n\nThe survey will tell us why customers renew.\n\n"
    "## Assumptions\n\nAssumption: the survey runs online for two weeks."
)


def test_a_met_without_evidence_does_not_read_as_praise_under_not_met():
    """11 Oct, survey brief: "The objective is not met yet", followed by the model
    saying the brief satisfied the requirements, and nothing named as failed."""
    a = parse_assessment({
        "outcome": "met", "reason": "The brief satisfies all of the requirements.", "basis_quote": "## Purpose",
    }, BRIEF, [])
    assert a.outcome == "partly"
    assert "could not point to a passage" in a.reason
    assert "satisfies" not in a.reason
    assert a.model_note == "The brief satisfies all of the requirements."


def test_a_model_not_met_with_named_criteria_names_them_first():
    a = parse_assessment({
        "outcome": "not_met", "reason": "Mostly fine.",
        "criteria": [
            {"requirement": "Exactly four sections", "verdict": "not_met", "basis": "It has two."},
            {"requirement": "Generic roles", "verdict": "not_checked", "basis": ""},
        ],
    }, BRIEF, [], ["Output: at most 200 words — measured 214 words"])
    assert a.reason == "Not met: Output: at most 200 words — measured 214 words; Exactly four sections — It has two."


def test_a_met_without_evidence_is_asked_once_more_before_it_can_pause_a_run():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=[
        ({"outcome": "met", "reason": "Fine.", "basis_quote": "## Purpose"}, {}),
        ({"outcome": "met", "reason": "Fine.", "basis_quote": "The survey will tell us why customers renew."}, {}),
    ])
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/agent/assess-objective", json={
            "inputs": _inputs().model_dump(), "deliverable_label": "Output", "content": BRIEF, "steps": [],
        })
        assert r.status_code == 200, r.text
        assert r.json()["outcome"] == "met"
        assert stub.generate_json.call_count == 2
        assert "YOUR PREVIOUS ANSWER said \"met\"" in stub.generate_json.call_args_list[1].kwargs["prompt"]
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_a_not_met_for_a_real_failure_is_not_asked_again():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"outcome": "not_met", "reason": "Too long."}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        TestClient(app).post("/api/agent/assess-objective", json={
            "inputs": _inputs().model_dump(), "deliverable_label": "Output", "content": BRIEF, "steps": [],
        })
        assert stub.generate_json.call_count == 1
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_the_prompt_asks_for_each_requirement_and_says_what_cannot_be_checked():
    _system, user = build_assessment_prompt(_inputs(), "Output", "text", [])
    assert '"criteria"' in user
    assert "how many pages it prints to" in user
    assert "A heading is not a basis." in user


MEASURED = ["The deliverable: at most 200 words — 187 words", "The deliverable: exactly 4 sections — 4 sections"]


def test_the_prompt_gives_the_counts_code_made_as_authoritative():
    _system, user = build_assessment_prompt(_inputs(), "Output", BRIEF, [], "", None, MEASURED)
    assert "MEASURED IN CODE AND MET" in user and "do not mark these requirements not met" in user
    assert "- The deliverable: at most 200 words — 187 words" in user
    assert "labelled assumptions count" in user


def test_a_length_the_model_miscounted_is_overruled_by_the_count_code_made():
    """11 Oct, survey brief: "it stopped again, this time saying the saved
    deliverable exceeds 200 words." Code counted it."""
    a = parse_assessment({
        "outcome": "not_met", "reason": "The brief exceeds 200 words.",
        "basis_quote": "The survey will tell us why customers renew.",
        "criteria": [
            {"requirement": "Capped at 200 words", "verdict": "not_met", "basis": "About 230 words."},
            {"requirement": "Exactly four sections", "verdict": "not_checked", "basis": ""},
            {"requirement": "Generic roles", "verdict": "met", "basis": "The survey will tell us why customers renew."},
        ],
    }, BRIEF, [], [], MEASURED)
    assert a.outcome == "met"
    assert [c.verdict for c in a.criteria] == ["met", "met", "met"]
    assert a.criteria[0].basis == "Measured in code: The deliverable: at most 200 words — 187 words"
    assert "Overruled by the count made in code" in a.model_note


def test_a_miscount_stated_only_in_the_reason_is_overruled_too():
    a = parse_assessment({"outcome": "not_met", "reason": "The saved deliverable exceeds 200 words."}, BRIEF, [], [], MEASURED)
    assert a.outcome == "partly"  # nothing quoted: not recorded as met, and not as a failure
    assert a.unmet == [] and "could not point to a passage" in a.reason


def test_a_real_failure_beside_a_miscount_still_fails():
    a = parse_assessment({
        "outcome": "not_met", "reason": "Too long and invents a company.",
        "criteria": [
            {"requirement": "Under 200 words", "verdict": "not_met", "basis": ""},
            {"requirement": "No invented company details", "verdict": "not_met", "basis": "Names Acme Corp."},
        ],
    }, BRIEF, [], [], MEASURED)
    assert a.outcome == "not_met"
    assert a.unmet == ["No invented company details — Names Acme Corp"]


def test_a_model_not_met_with_nothing_named_is_the_thing_unmet():
    a = parse_assessment({"outcome": "not_met", "reason": "The roles name real people."}, BRIEF, [])
    assert a.unmet == ["The roles name real people"]
    assert a.reason == "Not met: The roles name real people."


def test_lunch_invitation_49_words_is_not_over_the_accepted_70():
    """11 Oct, production (lunch invitation): Output v4 is 49 words; the check
    paused with "it exceeds the accepted under-70-word limit"."""
    invite = "Join us for lunch on Wednesday at 1:00 p.m. in the garden room."
    measured = ["Invitation: at most 70 words — 49 words"]
    a = parse_assessment({
        "outcome": "not_met", "reason": "It exceeds the accepted under-70-word limit.",
        "basis_quote": invite,
        "criteria": [{"requirement": "The invitation is under 70 words", "verdict": "not_met", "basis": "Too long."}],
    }, invite, [], [], measured)
    assert a.outcome == "met"
    assert a.criteria[0].basis == "Measured in code: Invitation: at most 70 words — 49 words"
    b = parse_assessment({"outcome": "not_met", "reason": "It exceeds the accepted under-70-word limit."}, invite, [], [], measured)
    assert b.unmet == [] and "could not point to a passage" in b.reason


def test_a_count_of_another_part_does_not_overrule_the_summary_verdict():
    """12 Oct (Sean, Diligence): the summary was over 250 words; a count of the
    whole pack's opening at 250 must not turn "not met" into "met"."""
    text = "Executive summary. The target operates three plants."
    measured = ["Report: at most 250 words — 180 words"]
    a = parse_assessment({
        "outcome": "not_met", "reason": "The executive summary is over 250 words.", "basis_quote": "The target operates three plants.",
        "criteria": [{"requirement": "The executive summary is at most 250 words", "verdict": "not_met", "basis": "About 280 words."}],
    }, text, [], [], measured)
    assert a.outcome != "met"
    assert a.criteria[0].verdict == "not_met"


# 14 Oct (Sean, SUMMIT): Luis's request was recorded as a requirement; the pack
# correctly refused it, and the check paused Go because it was "not met".
_SUMMIT_PACK = (
    "The approved launch date of November 24, 2026 matches the earliest compliant launch date. "
    "Reported November 16–17 activity is retained in history but excluded from the compliant five-day count."
)
_LUIS = "He asks to count those two days toward the required five testing days so testing can still finish November 20."


def _summit_result(requirement: str) -> dict:
    return {
        "outcome": "not_met", "reason": "The request was not carried out.", "basis_quote": "",
        "criteria": [
            {"requirement": "Keep the November 24 launch date", "verdict": "met",
             "basis": "The approved launch date of November 24, 2026 matches the earliest compliant launch date."},
            {"requirement": requirement, "verdict": "not_met",
             "basis": "the reported November 16–17 testing days cannot be counted as compliant testing days"},
        ],
    }


def test_a_recorded_request_is_not_an_unmet_criterion():
    a = parse_assessment(
        _summit_result("Count the November 16 and November 17 testing days toward the required five testing days so testing can still finish November 20"),
        _SUMMIT_PACK, [], requests=[_LUIS],
    )
    assert a.unmet == [] and "Count the November 16" not in a.reason
    assert a.outcome == "partly"  # nothing quoted as the basis: not "met", but nothing unmet either
    assert a.criteria[1].verdict == "not_checked"


def test_a_request_and_a_real_failure_still_fail_on_the_real_one():
    result = _summit_result("Omar proposes raising the budget to $86,000")
    result["criteria"].append({"requirement": "State the actual spending", "verdict": "not_met", "basis": "missing"})
    a = parse_assessment(result, _SUMMIT_PACK, [])
    assert a.outcome == "not_met" and a.unmet == ["State the actual spending — missing"]


def test_the_check_is_told_a_request_is_not_a_requirement():
    system, _ = build_assessment_prompt(PMInput(objective="Manage SUMMIT", mode="analyst"), "Output", "x", [])
    assert "is not a requirement of the objective" in system


def test_done_is_written_in_the_users_words():
    a = parse_assessment({"outcome": "not_met", "reason": "r", "performed": ["S1"]}, "x", [RunStep(action_key="recheck_stage", execution_label="designed")])
    assert a.performed == ["Repair a reopened stage (draft written)"]


# 13 Oct (Sean, workshop): "For 20 lunches within $240, clearly explain that we
# need a confirmed price of $12 per person or less."
_WORKSHOP_RECORD = "Attendance is now 20. The approved budget is $240. No cheaper lunch price is confirmed."


def _blocked(need: str, ask: str) -> dict:
    return {"outcome": "not_met", "reason": "No lunch plan fits.", "blockers": [{"need": need, "ask": ask, "kind": "source_missing"}]}


def test_a_blocker_states_the_value_needed_and_asks_for_it():
    a = parse_assessment(
        _blocked("a confirmed lunch price of $12 per person or less ($240 approved / 20 attendees)", "What is the confirmed lunch price per person, including taxes and fees?"),
        "Lunch: not confirmed.", [], record=_WORKSHOP_RECORD,
    )
    assert a.blockers[0].need == "a confirmed lunch price of $12 per person or less ($240 approved / 20 attendees)"
    assert a.blockers[0].ask.startswith("What is the confirmed lunch price")


def test_a_figure_the_record_does_not_give_is_not_shown():
    a = parse_assessment(_blocked("a confirmed lunch price of $9.50 per person or less", "Can you confirm a price of $9.50 or less?"), "x", [], record=_WORKSHOP_RECORD)
    assert "9.50" not in a.blockers[0].need and "9.50" not in a.blockers[0].ask
    assert a.blockers[0].need.startswith("a confirmed lunch price")


def test_the_check_is_asked_for_an_actionable_blocker():
    _, user = build_assessment_prompt(PMInput(objective="Plan the workshop", mode="analyst"), "Output", "x", [])
    assert '"ask"' in user and "A blocker is actionable" in user
