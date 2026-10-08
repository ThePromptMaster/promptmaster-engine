"""Maths and code are asked for in a form that renders (M1; Sean, 7 Oct)."""

from promptmaster.long_form import _section_system
from promptmaster.notation import NOTATION_RULE
from promptmaster.schemas import StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt


def test_stage_and_chapter_prompts_ask_for_latex_and_fenced_code(basic_inputs):
    system, _ = build_stage_prompt(basic_inputs, StageDescriptor(id="analysis", label="Analysis", renderer="prose"), StageDigest())
    assert NOTATION_RULE in system
    assert NOTATION_RULE in _section_system("")
    assert "never a comma where an equals sign belongs" in NOTATION_RULE
    assert "```python" in NOTATION_RULE
