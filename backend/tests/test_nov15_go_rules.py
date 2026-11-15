"""Sean's 13 Nov guest invitation and inventory audit (15 Nov): what Go's own
suggestions are, and where a table the user asked for belongs."""
from __future__ import annotations

from promptmaster.deliverable_check import _INSTRUCTION as CHECK
from promptmaster.project_context import facts_block
from promptmaster.question_screen import ScreenQuestionRequest, SCREEN_INSTRUCTION, build_screen_prompt, parse_screen
from promptmaster.saved_documents import DOCUMENTS_RULE
from promptmaster.schemas import PMInput
from promptmaster.workflow_designer import KINDS


def _inputs(**over) -> PMInput:
    base = {"objective": "An invitation pack for an open house.", "audience": "", "constraints": "Do not invent details.", "output_format": "", "mode": "architect"}
    return PMInput(**{**base, **over})


def _req(**over) -> ScreenQuestionRequest:
    return ScreenQuestionRequest(inputs=_inputs(), question="Should the schedule add a backup volunteer?", stage_label="Finish", **over)


def test_go_own_extra_is_an_optional_suggestion_left_out():
    assert "optional_suggestion" in SCREEN_INSTRUCTION
    out = parse_screen({"verdict": "optional_suggestion", "reason": "Nothing asked for it.", "suggestion": "A backup volunteer."}, _req())
    assert out.verdict == "optional_suggestion"
    assert out.suggestion == "A backup volunteer."


def test_an_extra_the_users_own_words_require_is_not_optional():
    req = ScreenQuestionRequest(inputs=_inputs(constraints="Two people on the door at all times."), question="Add a second greeter?", stage_label="Finish")
    out = parse_screen({"verdict": "optional_suggestion", "suggestion": "A second greeter.", "requirement_quote": "Two people on the door at all times."}, req)
    assert out.verdict == "business_decision"


def test_defaults_go_chose_are_not_the_users_words_and_are_never_promised():
    inputs = _inputs(facts=[{"statement": "Refreshments: one non-alcoholic option.", "kind": "fact", "origin": "policy"}])
    _system, user = build_screen_prompt(ScreenQuestionRequest(inputs=inputs, question="Promise drinks?", stage_label="Finish"))
    assert "Refreshments: one non-alcoholic option." not in user
    block = facts_block(inputs)
    assert "chosen by PromptMaster under the routine-decision policy, not stated by the user" in block
    assert "never promise it" in block


def test_earlier_suggestions_are_not_promised_to_readers():
    assert "Text written for other people" in DOCUMENTS_RULE
    assert "never promises or announces such a thing" in DOCUMENTS_RULE
    assert "a promise to the reader" in CHECK


def test_a_table_the_user_asks_for_is_written_on_the_finished_page():
    assert "shown as cards, not as a table" in KINDS["list"]
    assert "Markdown table" in KINDS["list"]
