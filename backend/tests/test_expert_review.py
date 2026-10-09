"""Q3a — the expert review package (Sean, 9 Oct, email 19)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.expert_review import RecordDocument, build_package_prompt, parse_package
from promptmaster.schemas import PMInput

INPUTS = PMInput(objective="Is the Regge action's continuum limit the Einstein-Hilbert action here?", audience="Physicists", mode="analyst")
DOCS = [
    RecordDocument(label="Analysis", text="We derive S = sum_h A_h epsilon_h and find the deficit angle scales as l^2 R."),
    RecordDocument(label="Experiment", text="Ran in the sandbox: deficit sum = 0.0123 at N = 64.", executed=True),
]


def test_the_prompt_carries_the_issue_the_saved_record_and_asks_for_one_judgment():
    system, user = build_package_prompt(INPUTS, "Whether the hinge-area weighting is the right measure", "Analysis", DOCS)
    assert "THE ISSUE THAT NEEDS AN EXPERT: Whether the hinge-area weighting is the right measure" in user
    assert "--- SAVED: Analysis ---" in user and "deficit angle scales as l^2 R" in user
    assert "--- SAVED: Experiment (records executed code) ---" in user
    assert "Every piece of working you cite must be copied exactly from the saved record" in system
    assert '"judgment_requested"' in user and '"depends_on_it"' in user


def test_working_not_in_the_record_is_dropped_and_executed_is_the_records_to_say():
    raw = {
        "question": "Is hinge-area weighting right?",
        "working": [
            {"quote": "the deficit angle scales as l^2 R", "label": "executed"},
            {"quote": "deficit sum = 0.0123 at N = 64", "label": "executed"},
            {"quote": "an invented derivation the project never made", "label": "derived"},
        ],
        "assumptions": [{"text": "Simplicial manifold is piecewise flat", "status": "accepted"}, {"text": "x", "status": "weird"}],
        "unresolved": "Which measure.",
        "judgment_requested": "Is the hinge-area weighting the correct discretisation of the curvature term?",
        "depends_on_it": ["Validation of the continuum limit"],
    }
    package = parse_package(raw, "issue", DOCS)
    assert [(w.source, w.label) for w in package.working] == [("Analysis", "derived"), ("Experiment", "executed")]
    assert package.assumptions[0].status == "accepted" and package.assumptions[1].status == "assumed"
    assert package.depends_on_it == ["Validation of the continuum limit"]


def test_an_unusable_reply_still_names_the_issue():
    package = parse_package("not json", "Whether the measure is right", DOCS)
    assert package.question == "Whether the measure is right"
    assert package.judgment_requested.startswith("Your judgment on:")


def test_the_endpoint_returns_the_package():
    client = AsyncMock()
    client.model = "test-model"
    client.generate_json = AsyncMock(return_value=({"question": "Q?", "unresolved": "U", "judgment_requested": "J"}, {}))
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/agent/expert-package", json={
            "inputs": INPUTS.model_dump(), "issue": "Measure", "stage_label": "Analysis",
            "documents": [d.model_dump() for d in DOCS],
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200, res.text
    assert res.json()["judgment_requested"] == "J"


def test_the_planner_asks_an_expert_about_a_specific_issue_and_may_continue_conditionally():
    from promptmaster.agent import _NEXT_ACTION_INSTRUCTION
    assert "never a general 'consult an expert'" in _NEXT_ACTION_INSTRUCTION
    assert "'Assumed, not verified: …'" in _NEXT_ACTION_INSTRUCTION


def test_conditional_results_and_ai_passes_do_not_meet_the_objective():
    from promptmaster.objective_assessment import _ASSESS_INSTRUCTION
    assert "resting on an unverified assumption" in _ASSESS_INSTRUCTION
    assert "independent human coders" in _ASSESS_INSTRUCTION
