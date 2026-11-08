"""What a finished document says is still to do in the real world (8 Nov)."""
from __future__ import annotations

from promptmaster import agent
from promptmaster.objective_assessment import _open_actions, build_assessment_prompt
from promptmaster.schemas import PMInput


def test_only_what_the_deliverable_says_and_once_each():
    text = "Book or confirm the trainer ($2,000), room and equipment for both dates. Order 28 sets of materials."
    assert _open_actions(["Book or confirm the trainer ($2,000), room and equipment for both dates.", "Hire a second trainer."], text) == [
        "Book or confirm the trainer ($2,000), room and equipment for both dates."
    ]
    assert _open_actions(["Order 28 sets of materials.", "order 28 sets  of materials."], text) == ["Order 28 sets of materials."]
    assert _open_actions("not a list", text) == []


def test_the_check_is_told_real_world_tasks_do_not_make_the_document_unfinished():
    system, user = build_assessment_prompt(PMInput(objective="A handoff.", mode="analyst"), "Final", "text", [])
    combined = system + user
    assert '"open_actions"' in combined
    assert "do not make the document unfinished" in combined
    assert "never ask the user whether it has happened" in combined.lower() or "never \nask" in combined.lower()


def test_the_planner_is_told_the_document_is_not_the_event():
    assert "THE DOCUMENT IS NOT THE EVENT" in agent._NEXT_ACTION_INSTRUCTION
    assert "Never ask the user whether it has happened" in agent._NEXT_ACTION_INSTRUCTION



def test_the_planner_gets_the_count_and_is_told_to_shorten_without_asking():
    from promptmaster.agent import AgentState, build_next_action_prompt

    note = "1,556 words, counted in code; the brief asks for roughly 900–1,200 words, so it is over"
    _, user = build_next_action_prompt(PMInput(objective="x", mode="analyst"), AgentState(stage_id="final", length_note=note), ["revise_stage"], "autonomous")
    assert note in user
    assert "never an estimate of your own" in user
    assert "Do not ask." in user
    _, without = build_next_action_prompt(PMInput(objective="x", mode="analyst"), AgentState(stage_id="final"), ["revise_stage"], "autonomous")
    assert "THE DELIVERABLE'S LENGTH" not in without
