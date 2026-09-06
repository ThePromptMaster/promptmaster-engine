"""The Research workflow's authored instructions, checked at the prompt seam.

The templates live in the frontend and reach the backend as request payload, so
these are the real strings rather than an import. That is the point: the seam
is `_shared_system(inputs, [], stage_instruction)`, and the only thing this
service promises about a stage is that whatever the template authored arrives
in the system prompt intact, alongside the mode scaffolding rather than in
place of it. A truncation, a substitution or a swallowed hint here is invisible
in the frontend tests and shows up as bland output nobody can explain.

Following tests/test_long_form_prompts.py: no network, no model, no client.
"""

from __future__ import annotations

import pytest

from promptmaster.conversation import _shared_system
from promptmaster.schemas import (
    StageDescriptor,
    StageDigest,
    StageDigestEntry,
    StageItemField,
    StageItemSchema,
)
from promptmaster.stage import _parse_items, build_stage_prompt

# Verbatim from frontend/src/lib/workflow/templates/research.v1.ts (v2). Each
# ends with its failure mode, which is the clause the stage exists for.
HYPOTHESIS_HINT = (
    "Produce falsifiable propositions, not a discussion of what might be going "
    "on. 'statement' is the proposition in one flat sentence; 'prediction' is "
    "what you should observe if it holds, specific enough that someone else "
    "could go and look — direction, and a magnitude or threshold wherever you "
    "can give one; 'disconfirming_observation' is the result that would make "
    "you abandon it. The third field is the test of the other two: if it "
    "cannot be filled in without hedging, the hypothesis cannot be wrong, and "
    "a hypothesis that cannot be wrong is not a hypothesis, it is the question "
    "restated in a confident voice."
)

METHOD_HINT = (
    "Produce the method as a pre-registration: what will be done and in what "
    "order; each variable and how it is measured; the controls and what they "
    "rule out; the sample or scale and why it is enough; and the analysis plan "
    "— which comparison decides which hypothesis, on which measure, against "
    "which threshold — committed here, before any data exists. An analysis "
    "chosen after the results are in is not a method, it is a description of "
    "the results."
)


@pytest.fixture
def hypothesis_stage() -> StageDescriptor:
    return StageDescriptor(
        id="hypothesis",
        label="Hypothesis or proposition",
        renderer="list",
        entry_prompt_hint=HYPOTHESIS_HINT,
        artifact_kind="hypotheses",
    )


@pytest.fixture
def method_stage() -> StageDescriptor:
    return StageDescriptor(
        id="method",
        label="Method",
        renderer="prose",
        entry_prompt_hint=METHOD_HINT,
        artifact_kind="method",
    )


@pytest.fixture
def hypothesis_schema() -> StageItemSchema:
    """Mirrors ITEM_SCHEMAS['hypotheses'] — the other half of the contract."""
    return StageItemSchema(
        item_label="hypothesis",
        min_items=1,
        max_items=6,
        fields=[
            StageItemField(key="statement", label="Statement"),
            StageItemField(key="prediction", label="What it predicts"),
            StageItemField(
                key="disconfirming_observation", label="What would show it false"
            ),
        ],
    )


@pytest.fixture
def digest() -> StageDigest:
    return StageDigest(
        objective="Does queue latency drive churn on the free tier?",
        audience="The study's own reviewers",
        prior_stages=[
            StageDigestEntry(
                stage_id="literature",
                label="Literature context",
                summary="Three studies measure churn against price; none against latency.",
            )
        ],
    )


# --- the seam ---------------------------------------------------------------

def test_the_authored_instruction_reaches_the_system_prompt(
    basic_inputs, method_stage, digest
):
    system, _user = build_stage_prompt(basic_inputs, method_stage, digest)
    assert METHOD_HINT in system


def test_the_hint_is_appended_to_the_mode_scaffolding_not_substituted_for_it(
    basic_inputs, method_stage, digest
):
    """A stage must not silently drop the mode the user selected."""
    system, _user = build_stage_prompt(basic_inputs, method_stage, digest)
    baseline = _shared_system(basic_inputs, [], "")
    # Everything _shared_system contributes on its own is still present.
    for marker in ("PromptMaster Engine", "Session history:"):
        assert marker in baseline
        assert marker in system
    assert system.index("PromptMaster Engine") < system.index(METHOD_HINT)


def test_the_failure_mode_clause_survives_intact(basic_inputs, method_stage, digest):
    """The tail of the hint is the half that does the work.

    Truncating an instruction usually costs its last sentence, which here is
    exactly the sentence keeping the model from writing the analysis plan after
    seeing the numbers.
    """
    system, _user = build_stage_prompt(basic_inputs, method_stage, digest)
    assert "is not a method, it is a description of the results" in system


def test_a_list_stage_carries_both_the_hint_and_its_fields(
    basic_inputs, hypothesis_stage, digest, hypothesis_schema
):
    system, user = build_stage_prompt(
        basic_inputs, hypothesis_stage, digest, hypothesis_schema
    )
    assert HYPOTHESIS_HINT in system
    # The hint names the fields; the schema declares them. Both halves have to
    # reach the model or the column the prompt asks for is dropped on parse.
    for key in ("statement", "prediction", "disconfirming_observation"):
        assert key in system
        assert key in user
        assert key in HYPOTHESIS_HINT


def test_the_prompt_asks_for_the_disconfirmer_the_exit_criterion_gates_on(
    basic_inputs, hypothesis_stage, digest, hypothesis_schema
):
    """hyp.disconfirm is a blocking criterion. A stage whose prompt does not
    ask for the disconfirming observation generates artifacts that cannot pass
    their own gate."""
    system, _user = build_stage_prompt(
        basic_inputs, hypothesis_stage, digest, hypothesis_schema
    )
    assert "disconfirming_observation" in system
    assert "cannot be wrong is not a hypothesis" in system


def test_the_upstream_stage_reaches_the_user_prompt(
    basic_inputs, hypothesis_stage, digest
):
    """Research's literature stage is what the hypothesis is written against."""
    _system, user = build_stage_prompt(basic_inputs, hypothesis_stage, digest)
    assert "none against latency" in user
    assert digest.objective in user


def test_the_declared_fields_survive_the_parse(hypothesis_schema):
    """The columns the hint asks for are the columns that come back.

    _parse_items drops anything the schema does not declare, so a hint naming a
    field the registry lacks produces an empty column and a stage that looks
    broken for no visible reason.
    """
    items = _parse_items(
        {
            "items": [
                {
                    "id": "h1",
                    "statement": "Queue latency above 400ms drives free-tier churn.",
                    "prediction": "Churn rises with p95 latency, roughly linearly.",
                    "disconfirming_observation": "Churn flat across the latency range.",
                }
            ]
        },
        hypothesis_schema,
    )
    row = items[0].model_dump()
    assert row["disconfirming_observation"] == "Churn flat across the latency range."


def test_a_review_stage_keeps_its_status_and_reason(basic_inputs, digest):
    """Research's experiment stage gates on every_item_has_status, so a row's
    triage state has to survive the parse even though no schema declares it."""
    stage = StageDescriptor(
        id="experiment",
        label="Experiment or investigation",
        renderer="review",
        entry_prompt_hint="Every row needs a status, and a run that was not done needs a reason.",
        artifact_kind="runs",
    )
    schema = StageItemSchema(
        item_label="run",
        fields=[StageItemField(key="run", label="What was to be done")],
    )
    _system, user = build_stage_prompt(basic_inputs, stage, digest, schema)
    assert '"items"' in user

    items = _parse_items(
        {"items": [{"id": "r1", "run": "Cohort B", "status": "not_run", "reason": "Instrument failed."}]},
        schema,
    )
    row = items[0].model_dump()
    assert row["status"] == "not_run"
    assert row["reason"] == "Instrument failed."
