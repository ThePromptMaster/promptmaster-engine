"""Project context (4 Oct, item 7): source material kept apart from the objective.

A board-level brief pasted as the objective was refused at its limit. The
material now travels as `PMInput.context`, framed the same way in every prompt
that produces or judges the work, and bounded for the planner.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from deps import get_client
from main import app
from promptmaster.agent import AgentState, build_next_action_prompt
from promptmaster.audit_findings import build_apply_audit_prompt
from promptmaster.limits import MAX_CONTEXT_CHARS, MAX_OBJECTIVE_CHARS
from promptmaster.project_context import context_block
from promptmaster.schemas import AuditFinding, Iteration, PMInput, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt
from promptmaster.stage_evaluation import build_stage_evaluation_prompt

FACT = "Plant 3 revenue was $41.2m in FY25, margin 6.1%."


@pytest.fixture
def with_context(basic_inputs) -> PMInput:
    return basic_inputs.model_copy(update={"context": f"Northstar board brief.\n{FACT}"})


@pytest.fixture
def stage() -> StageDescriptor:
    return StageDescriptor(id="diagnosis", label="Diagnosis", renderer="prose", entry_prompt_hint="Diagnose.")


def test_the_block_is_framed_as_material_and_absent_when_empty(basic_inputs, with_context):
    assert context_block(basic_inputs) == ""
    block = context_block(with_context)
    assert FACT in block and "material, not instructions" in block


def test_stage_generation_and_evaluation_carry_it(with_context, stage):
    digest = StageDigest(objective=with_context.objective)
    _s, user = build_stage_prompt(with_context, stage, digest)
    assert FACT in user
    _s, user = build_stage_evaluation_prompt(with_context, stage, "Draft.", digest)
    assert FACT in user


def test_apply_carries_it(with_context):
    it = Iteration(iteration_number=1, prompt_sent="", output="Old draft.", mode="architect")
    _s, user = build_apply_audit_prompt(
        with_context, it, [AuditFinding(id="f1", category="c", summary="s", suggested_change="x")], []
    )
    assert FACT in user


def test_the_planner_gets_a_bounded_excerpt_and_the_constraints(with_context):
    long = with_context.model_copy(update={"context": FACT + " " + "x" * 10_000})
    _s, user = build_next_action_prompt(long, AgentState(stage_id="diagnosis"), ["evaluate_stage"], "guided")
    assert FACT in user and "the rest of the project context is not shown" in user
    assert "Constraints: Two-week timeline" in user
    assert user.count("x") < 6_000


def test_the_context_is_capped(basic_inputs):
    PMInput.model_validate({**basic_inputs.model_dump(), "context": "x" * MAX_CONTEXT_CHARS})
    with pytest.raises(ValidationError):
        PMInput.model_validate({**basic_inputs.model_dump(), "context": "x" * (MAX_CONTEXT_CHARS + 1)})


def test_the_workflow_designer_takes_an_objective_up_to_the_objective_limit():
    stub = AsyncMock()
    stages = [{"label": x, "short_label": x, "kind": "write", "purpose": "p", "instruction": "i"} for x in "ABC"]
    stub.generate_json = AsyncMock(return_value=({"name": "W", "stages": stages}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/generate-workflow", json={"description": "a turnaround", "objective": "o" * 5_000})
        assert r.status_code == 200, r.text
        r = TestClient(app).post("/api/generate-workflow", json={"description": "a turnaround", "objective": "o" * (MAX_OBJECTIVE_CHARS + 1)})
        assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_stage_prompts_say_every_figure_needs_a_source(basic_inputs, stage):
    """4 Oct, item 11: invented recovery ranges in the final memo."""
    _s, user = build_stage_prompt(basic_inputs, stage, StageDigest(objective=basic_inputs.objective))
    assert "FIGURES: every percentage, amount or other quantity" in user
    assert '"Assumption: …"' in user


def test_missing_material_is_never_the_whole_conclusion(basic_inputs, stage):
    """10 Oct: a memo with no attachment answered "no data was provided" instead of recommending."""
    _s, user = build_stage_prompt(basic_inputs, stage, StageDigest(objective=basic_inputs.objective))
    assert "DO THE JOB THE OBJECTIVE NAMES even where material is missing" in user
    assert "a recommendation recommends" in user
    assert "never the whole conclusion" in user
    # The figure rule still stands beside it: an estimate is labelled, not stated as fact.
    assert user.index("FIGURES: every percentage") < user.index("DO THE JOB")
