"""PM-21 and PM-25: critique intensity and tone are separate; the evaluator says
when no further pass is needed.

Asserted on the prompt text itself, never on model output.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from promptmaster.critique_style import (
    INTENSITY_RULES,
    MAX_FINDINGS,
    TONE_RULES,
    critique_style_block,
)
from promptmaster.flow_triggers import build_flow_trigger_prompt
from promptmaster.schemas import PMInput, StageDescriptor, StageDigest
from promptmaster.stage_evaluation import (
    build_stage_evaluation_prompt,
    evaluate_stage_artifact,
    parse_stage_evaluation,
)

STAGE = StageDescriptor(id="drafting", label="Drafting", renderer="prose")


def inputs(**kw) -> PMInput:
    return PMInput(objective="A short book about giraffes", audience="Children", mode="architect", **kw)


# --- the separation, on the text itself --------------------------------------------

WORDING = ("tone", "word", "gentle", "warm", "blunt", "harsh", "soft", "encourag", "praise", "sarcas")
FINDING = ("finding", "score", "bar", "claim", "defect", "problems that", "examine")


@pytest.mark.parametrize("level", list(INTENSITY_RULES))
def test_intensity_rules_say_nothing_about_wording(level):
    text = INTENSITY_RULES[level].lower()
    assert not [w for w in WORDING if w in text]


@pytest.mark.parametrize("tone", list(TONE_RULES))
def test_tone_rules_say_nothing_about_what_is_found(tone):
    text = TONE_RULES[tone].lower()
    assert not [w for w in FINDING if w in text]


def test_the_block_states_the_rule_that_keeps_them_apart():
    block = critique_style_block("rigorous", "gentle")
    assert "CRITIQUE INTENSITY — RIGOROUS" in block
    assert "COMMUNICATION TONE — GENTLE" in block
    assert "A gentle tone never softens a score, hides a finding or lowers the bar" in block


def test_unknown_values_fall_back_rather_than_fail():
    assert "STANDARD" in critique_style_block("brutal", None)
    assert "NEUTRAL" in critique_style_block(None, "snarky")


def _eval_system(**kw) -> str:
    return build_stage_evaluation_prompt(inputs(**kw), STAGE, "Giraffes are tall.", StageDigest())[0]


def test_changing_tone_changes_only_the_tone_line_of_the_evaluator():
    gentle = _eval_system(critique_intensity="rigorous", critique_tone="gentle").splitlines()
    direct = _eval_system(critique_intensity="rigorous", critique_tone="direct").splitlines()
    differing = [a for a, b in zip(gentle, direct) if a != b]
    assert len(gentle) == len(direct)
    assert len(differing) == 1 and differing[0].startswith("COMMUNICATION TONE")


def test_changing_intensity_changes_only_the_intensity_line_of_the_evaluator():
    light = _eval_system(critique_intensity="light", critique_tone="direct").splitlines()
    rigorous = _eval_system(critique_intensity="rigorous", critique_tone="direct").splitlines()
    differing = [a for a, b in zip(light, rigorous) if a != b]
    assert len(differing) == 1 and differing[0].startswith("CRITIQUE INTENSITY")


@pytest.mark.parametrize("trigger", ["challenge", "reframe", "self_audit"])
def test_every_critique_carries_the_style(trigger):
    system, _ = build_flow_trigger_prompt(
        inputs(critique_intensity="light", critique_tone="gentle"), "Giraffes are tall.", trigger, None, []
    )
    assert "CRITIQUE INTENSITY — LIGHT" in system
    assert "COMMUNICATION TONE — GENTLE" in system


def test_challenge_no_longer_hardcodes_harsh_wording():
    system, _ = build_flow_trigger_prompt(inputs(critique_tone="gentle"), "x", "challenge", None, [])
    assert "Be blunt" not in system


def test_defaults_are_standard_and_neutral():
    assert "CRITIQUE INTENSITY — STANDARD" in _eval_system()
    assert "COMMUNICATION TONE — NEUTRAL" in _eval_system()


# --- PM-25: further pass ----------------------------------------------------------------

CLEAN = {
    "alignment": {"score": "High", "explanation": "a"},
    "drift": {"score": "Low", "explanation": "b"},
    "clarity": {"score": "High", "explanation": "c"},
    "completeness": {"status": "complete", "reason": ""},
    "findings": [],
}


def test_the_evaluator_is_asked_whether_another_pass_is_needed():
    system, user = build_stage_evaluation_prompt(inputs(), STAGE, "x", StageDigest())
    assert "FURTHER PASS (PM-25)" in system
    assert "do not recommend another pass out of habit" in system
    assert '"further_pass"' in user


def test_a_clean_artifact_can_be_declared_done():
    ev = parse_stage_evaluation({**CLEAN, "further_pass": {"needed": False, "reason": "It meets the bar."}}).evaluation
    assert ev.further_pass_needed is False
    assert ev.further_pass_reason == "It meets the bar."


@pytest.mark.parametrize(
    "override",
    [
        {"alignment": {"score": "Low", "explanation": "x"}},
        {"drift": {"score": "High", "explanation": "x"}},
        {"completeness": {"status": "incomplete", "reason": "cut off"}},
        {"findings": [{"id": "f1", "category": "c", "summary": "s", "suggested_change": "d"}]},
    ],
)
def test_done_is_overruled_by_the_evaluations_own_scores(override):
    raw = {**CLEAN, **override, "further_pass": {"needed": False, "reason": "Looks fine."}}
    ev = parse_stage_evaluation(raw).evaluation
    assert ev.further_pass_needed is True
    assert ev.further_pass_reason != "Looks fine."


def test_an_unanswered_question_stays_unanswered():
    assert parse_stage_evaluation(CLEAN).evaluation.further_pass_needed is None


def test_findings_are_capped_by_intensity():
    raw = {**CLEAN, "findings": [{"id": f"f{i}", "category": "c", "summary": "s", "suggested_change": "d"} for i in range(12)]}
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(raw, {}))
    for level, cap in MAX_FINDINGS.items():
        res = asyncio.run(evaluate_stage_artifact(client, inputs(critique_intensity=level), STAGE, "x", StageDigest()))
        assert len(res.evaluation.findings) == cap
