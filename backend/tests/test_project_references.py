"""Another project's material in this one's prompts (client, 21 Oct, email 5:
"the project you are working on can use that information from those other
chosen files or projects")."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from promptmaster.precedence import PRECEDENCE
from promptmaster.project_context import REFERENCES_HEADER, context_block, references_block
from promptmaster.schemas import AcceptedFact, PMInput as _PMInput, ReferencedProject


def PMInput(**kw):  # noqa: N802
    return _PMInput(**{"objective": "A launch plan for Harbor.", "mode": "architect", **kw})


REF = ReferencedProject(
    title="Harbor survey",
    objective="Find out what Harbor's customers want.",
    deliverable="Final report",
    excerpt="Customers want offline mode first. " * 40,
    facts=["Survey ran 1–14 Oct", "312 responses"],
)


def test_a_reference_is_numbered_labelled_and_ranked_below_this_project():
    block = references_block(PMInput(references=[REF]))
    assert block.startswith(REFERENCES_HEADER)
    assert "[R1] Harbor survey" in block
    assert "Objective: Find out what Harbor's customers want." in block
    assert "Final report:\n<<<\nCustomers want offline mode first." in block
    assert "Its facts: Survey ran 1–14 Oct; 312 responses" in block
    assert "this project wins" in REFERENCES_HEADER
    assert "never present it as decided here" in REFERENCES_HEADER


def test_it_comes_last_in_every_prompts_context():
    inputs = PMInput(
        context="Our own brief.",
        facts=[AcceptedFact(statement="Launch is 1 Dec", subject="launch", kind="fact", source="brief")],
        references=[REF],
    )
    block = context_block(inputs)
    assert block.index("Launch is 1 Dec") < block.index("Our own brief.") < block.index(REFERENCES_HEADER)


def test_a_project_with_only_references_still_carries_them():
    assert REFERENCES_HEADER in context_block(PMInput(references=[REF]))
    assert context_block(PMInput()) == ""


def test_the_planner_sees_the_gist_only():
    block = context_block(PMInput(references=[REF]), limit=2_000)
    assert "[R1] Harbor survey" in block
    assert "[…]" in block
    assert len(block) < len(context_block(PMInput(references=[REF])))
    assert "Its facts" not in block


def test_bounds_are_enforced_before_a_handler_runs():
    with pytest.raises(ValidationError):
        PMInput(references=[REF] * 6)
    with pytest.raises(ValidationError):
        ReferencedProject(title="x", excerpt="a" * 16_001)


def test_a_reference_ranks_below_the_project_and_above_model_text():
    keys = [k for k, _ in PRECEDENCE]
    assert keys.index("constraint") < keys.index("reference") < keys.index("generated")
