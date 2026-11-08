"""A suggestion stays a suggestion (8 Nov)."""
from __future__ import annotations

from promptmaster.project_context import SUGGESTIONS_RULE, context_block, facts_block
from promptmaster.schemas import AcceptedFact, PMInput


def test_every_prompt_with_facts_is_told_what_is_a_requirement():
    block = facts_block(PMInput(mode="analyst", objective="x", facts=[AcceptedFact(statement="Budget is 6,000.")]))
    assert SUGGESTIONS_RULE in block
    assert "never a condition of proceeding" in block
    assert "do not recalculate it on a later base" in block


def test_an_assumed_fact_is_labelled_and_a_stated_one_is_not():
    block = facts_block(PMInput(mode="analyst", objective="x", facts=[
        AcceptedFact(statement="Vendor quote is 500.", origin="model_assumed"),
        AcceptedFact(statement="Budget is 6,000."),
    ]))
    assert "Vendor quote is 500. (assumed by PromptMaster, not stated by the user)" in block
    assert "Budget is 6,000.\n" in block or block.count("assumed by PromptMaster") == 1


def test_no_facts_no_rule():
    assert SUGGESTIONS_RULE not in context_block(PMInput(mode="analyst", objective="x"))
