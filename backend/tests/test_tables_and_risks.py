"""20 Nov (Sean, warehouse rerun), asserted on the prompts.

1. "The schedule puts the 8 employees without a slot under 'Total planned', so the
   column adds up to 24. Can we list those 8 below the table so the scheduled
   total is clearly 16?"
2. "The package asks me to separately accept the lack of spare seats. That's a
   risk to explain. The decision I actually need to make is how to cover the 8
   employees without a session. Moving the launch date still requires confirmed
   trainer time."

The second came from the brief itself: the start conversation's reply ("The
package will flag that as a decision for you") went to the setup as material the
user attached, and the project's constraints said "must flag the zero-slack risk
as a decision for the user".
"""

from promptmaster import audit_findings, continuity, conversation, deliverable_check, front_door, setup_suggester
from promptmaster.long_form import build_section_prompt
from promptmaster.reader_text import DECISIONS_RULE, TABLE_ROWS_RULE, WRITING_RULES
from promptmaster.saved_text_checks import VERIFY_RULE
from promptmaster.schemas import OutlineSection, PMInput, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt
from promptmaster.workflow_designer import build_workflow_prompt

INPUTS = PMInput(objective="A readiness package for a scanner rollout", audience="Warehouse leads", mode="architect")


def test_the_rules_say_what_he_asked():
    assert "goes in a line below the table, never as a row whose number is counted in the column" in TABLE_ROWS_RULE
    assert "Never list a risk as a decision to accept, unless the user asked for that" in DECISIONS_RULE
    assert "a later date still needs the people, time or approval the current plan is short of" in DECISIONS_RULE
    # 20 Nov, production pass: "Move the launch later" came back "Excluded" after "keep Day 3".
    assert "never as excluded or not applicable" in DECISIONS_RULE


def test_every_writer_carries_them():
    stage_system, _ = build_stage_prompt(INPUTS, StageDescriptor(id="package", label="Package", renderer="prose"), StageDigest())
    section_system, _ = build_section_prompt(INPUTS, [OutlineSection(id="s1", title="Schedule", abstract="Who trains when.")], 0, None, "")
    for name, text in [
        ("stage writer", stage_system),
        ("chapter writer", section_system),
        ("side chat Change it", conversation._APPLY_INSTRUCTION),
        ("save as new version", conversation._SAVE_AS_NEW_INSTRUCTION),
        ("Go and review apply", audit_findings._APPLY_AUDIT_INSTRUCTION),
        ("continue writing", continuity._CONTINUATION_INSTRUCTION.format(completed_topics="", current_topic="", key_definitions="", next_topic_hint="")),
    ]:
        assert WRITING_RULES in text, name


def test_the_checks_look_for_both():
    assert "a risk listed as a decision for the user to accept" in VERIFY_RULE
    assert "people with no session counted as planned" in VERIFY_RULE
    assert "an option that leaves out what it still needs" in VERIFY_RULE
    assert "counts rows the table is not about" in deliverable_check._INSTRUCTION


def test_the_setup_never_makes_a_constraint_of_a_risk():
    system = setup_suggester.SETUP_SUGGESTER_SYSTEM
    assert "or that follow directly from what they said" not in system
    assert "Never make a constraint out of a risk you notice" in system
    assert 'something to \\"flag as a decision\\"' in system or 'something to "flag as a decision"' in system


def test_the_designer_and_the_start_conversation_keep_a_risk_a_risk():
    system, user = build_workflow_prompt("A readiness package", "Build it")
    assert "is never an approval, a decision or a stop condition" in f"{system}\n{user}"
    assert "never tell the user it will be made a decision for them" in front_door._SYSTEM
