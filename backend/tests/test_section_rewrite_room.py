"""A rewrite of a long section has room for the whole section, and if it is still cut off
the part that finishes it knows what the rewrite was for (9 Nov, production).

"Add one closing sentence" on a 4,200-word chapter was cut off before the end. The continuation
was told nothing of the rewrite and shown none of the old text, so it wrote a new ending and the
sentence never landed.
"""

from __future__ import annotations

from promptmaster.long_form import _section_token_limit, build_section_continuation_prompt
from promptmaster.schemas import OutlineSection, PMInput, SectionContinuation, SectionRevisionBrief

INPUTS = PMInput(objective="A short guide.", mode="architect")
OUTLINE = [OutlineSection(id="a", title="One", abstract="The first part.")]


def test_a_first_draft_keeps_its_limit():
    assert _section_token_limit(None) == 4096


def test_a_rewrite_has_room_for_the_section_it_hands_back():
    chapter = SectionRevisionBrief(current_content="word " * 4_600)  # 23,000 characters
    assert _section_token_limit(chapter) > 7_000
    assert _section_token_limit(SectionRevisionBrief(current_content="short")) == 4096
    assert _section_token_limit(SectionRevisionBrief(current_content="x" * 300_000)) == 16_384


def test_a_cut_rewrite_is_carried_on_with_its_brief_and_the_old_text():
    _system, user = build_section_continuation_prompt(
        INPUTS, OUTLINE, 0,
        SectionContinuation(text_so_far="It stops ha", unfinished="It stops ha", revision_brief="Add one closing sentence.", rest_of_current="The old ending."),
    )
    assert "THIS SECTION WAS BEING REWRITTEN" in user
    assert "Add one closing sentence." in user
    assert "The old ending." in user
    assert "word for word wherever the rewrite does not change it" in user
    assert "including anything it asks for at the end" in user


def test_a_first_draft_carried_on_hears_nothing_of_a_rewrite():
    _system, user = build_section_continuation_prompt(INPUTS, OUTLINE, 0, SectionContinuation(text_so_far="It stops ha", unfinished="It stops ha"))
    assert "BEING REWRITTEN" not in user
