"""An explicit change of scope reaches the project's stored setup (1 Nov, Sean, tattoo memo).

After the final memo he instructed: compare expanded hours (B) with keeping
operations unchanged (C) only, drop the second location (A), replace the $40,000
reserve with $75,000, and update the objective, requirements and analysis. The
requirements were recorded; the stored objective and constraints kept A and
$40,000, and every recheck was handed them as authoritative.
"""

from __future__ import annotations

from promptmaster.revision_facts import ProjectSetup, RevisionFactsRequest, build_prompt, parse

INSTRUCTION = (
    "Compare expanded hours with keeping operations unchanged only. Remove the second-location option from "
    "active consideration and keep it in history. Replace the $40,000 reserve with $75,000. Update the "
    "objective, requirements and affected analysis. Keep the memo under 1,000 words."
)
SETUP = ProjectSetup(
    objective="Decide whether to open a second location (A), expand hours at the existing shop (B), or hold steady while collecting evidence (C).",
    constraints="Keep a minimum cash reserve of $40,000. Memo under 1,000 words.",
)


def _req(setup: ProjectSetup | None = SETUP) -> RevisionFactsRequest:
    return RevisionFactsRequest(instruction=INSTRUCTION, before="old memo", after="new memo comparing B and C", setup=setup)


def test_the_prompt_carries_the_setup_and_asks_for_setup_changes():
    system, user = build_prompt(_req())
    assert "PROJECT SETUP:" in user and "$40,000" in user
    assert "setup_changes" in system and "ONLY when the INSTRUCTION itself replaces what they say" in system


def test_a_client_without_setup_is_asked_nothing_about_it():
    _, user = build_prompt(_req(None))
    assert "PROJECT SETUP:" not in user
    assert parse({"setup_changes": [{"field": "objective", "proposed": "x" * 20, "quote": "Update the objective"}]}, _req(None)).setup_changes == []


def test_a_setup_change_is_kept_only_with_a_quote_from_the_instruction():
    raw = {
        "setup_changes": [
            {"field": "objective", "proposed": "Decide between expanding hours (B) and holding steady while collecting evidence (C).", "quote": "Compare expanded hours with keeping operations unchanged only."},
            {"field": "constraints", "proposed": "Keep a minimum cash reserve of $75,000. Memo under 1,000 words.", "quote": "Replace the $40,000 reserve with $75,000."},
        ]
    }
    got = parse(raw, _req()).setup_changes
    assert [c.field for c in got] == ["objective", "constraints"]
    assert "$75,000" in got[1].proposed


def test_an_invented_quote_or_an_unchanged_field_is_dropped():
    raw = {
        "setup_changes": [
            {"field": "objective", "proposed": "Something else entirely here.", "quote": "Make the memo friendlier in tone."},
            {"field": "constraints", "proposed": SETUP.constraints, "quote": "Replace the $40,000 reserve with $75,000."},
            {"field": "audience", "proposed": "Investors and the bank.", "quote": "Replace the $40,000 reserve with $75,000."},
        ]
    }
    assert parse(raw, _req()).setup_changes == []


def test_an_explicit_change_of_objective_outranks_the_earlier_objective_in_every_prompt():
    from promptmaster.conversation import _APPLY_INSTRUCTION, _PROMPTMASTER_CONTEXT
    from promptmaster.precedence import PRECEDENCE_TEXT
    from promptmaster.self_model import PROMPTMASTER_SELF_MODEL

    assert "explicit instruction to change the objective" in PROMPTMASTER_SELF_MODEL
    assert "the earlier objective is then history" in PROMPTMASTER_SELF_MODEL
    assert "their latest word on it is the objective" in PRECEDENCE_TEXT
    assert "when they explicitly change it, their change is the objective" in _PROMPTMASTER_CONTEXT
    assert "write the work for the changed objective" in _APPLY_INSTRUCTION


def test_record_keeping_never_goes_into_the_deliverable():
    """The revised memo said the stored objective and requirements had not changed."""
    from promptmaster.conversation import _APPLY_INSTRUCTION
    from promptmaster.self_model import PROMPTMASTER_SELF_MODEL

    assert "Never write about PromptMaster's own records inside the work" in PROMPTMASTER_SELF_MODEL
    assert "Never mention the record, or whether it has changed, in the work itself." in _APPLY_INSTRUCTION
