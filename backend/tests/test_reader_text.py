"""28 Oct (Sean, HarborDesk): internal version and review terms in the final
documents. Asserted on the prompts that write the work."""

from promptmaster.long_form import build_section_prompt
from promptmaster.schemas import OutlineSection, PMInput, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt

INPUTS = PMInput(objective="A customer support playbook", audience="Agents", mode="architect")


def test_a_prose_stage_is_told_to_write_for_its_reader():
    system, _ = build_stage_prompt(INPUTS, StageDescriptor(id="draft", label="Draft", renderer="prose"), StageDigest())
    assert "WRITTEN FOR ITS READER" in system
    assert "unless the brief or the user asks for a change log" in system


def test_a_chapter_is_told_to_write_for_its_reader():
    outline = [OutlineSection(id="s1", title="Escalation", abstract="When to escalate.")]
    system, _ = build_section_prompt(INPUTS, outline, 0, None, "")
    assert "WRITTEN FOR ITS READER" in system
