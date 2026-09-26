"""PM-16 and PM-11: PromptMaster's self-model, and "do the work", reach the model.

Asserted on the prompts every generation path actually sends, not on the
constant — a constant nobody includes would pass a test of the constant.
"""

from promptmaster.conversation import build_chat_reply_prompt
from promptmaster.flow_triggers import build_flow_trigger_prompt
from promptmaster.schemas import Iteration, OutlineSection, PMInput, StageDescriptor, StageDigest
from promptmaster.self_model import PROMPTMASTER_SELF_MODEL
from promptmaster.stage import build_stage_prompt
from promptmaster.stage_evaluation import build_stage_evaluation_prompt

INPUTS = PMInput(objective="A short book about giraffes", audience="Children", mode="architect")
STAGE = StageDescriptor(id="drafting", label="Drafting", renderer="prose")
ITER = Iteration(iteration_number=1, prompt_sent="", output="Giraffes are tall.", mode="architect")

KEY_LINES = [
    "The user's objective is authoritative",
    "Project state persists",
    "The workflow says where the user is",
    "The mode shapes how you think",
    "A recommendation carries its reason",
    "Check for drift, and for conflicts",
    "say plainly when no further pass is needed",
    "Never state or imply that something was done",
]


def _assert_self_model(system: str) -> None:
    for line in KEY_LINES:
        assert line in system, line


def test_the_self_model_says_what_sean_asked_for():
    for line in KEY_LINES:
        assert line in PROMPTMASTER_SELF_MODEL


def test_stage_drafting_carries_it():
    system, _user = build_stage_prompt(INPUTS, STAGE, StageDigest())
    _assert_self_model(system)


def test_stage_evaluation_carries_it():
    system, _user = build_stage_evaluation_prompt(INPUTS, STAGE, "x", StageDigest())
    _assert_self_model(system)


def test_side_chat_carries_it():
    system, _user = build_chat_reply_prompt(INPUTS, ITER, [], "Is this clear?", [])
    _assert_self_model(system)


def test_flow_triggers_carry_it():
    for trigger in ("challenge", "refine_shorter", "drift_alert"):
        system, _user = build_flow_trigger_prompt(INPUTS, "Some output.", trigger, None, [])
        _assert_self_model(system)


def test_long_form_sections_carry_it():
    from promptmaster.long_form import build_section_prompt

    outline = [OutlineSection(id="s1", title="Habitat", abstract="Where they live.")]
    system, _user = build_section_prompt(INPUTS, outline, 0, None, "")
    _assert_self_model(system)


def test_a_prose_stage_is_told_to_produce_the_deliverable_not_notes_about_it():
    """PM-11: 'if the Book workflow reaches Drafting, PromptMaster should actually
    draft the manuscript or sections. It should not just create notes about drafting.'"""
    system, _user = build_stage_prompt(INPUTS, STAGE, StageDigest())
    assert "Produce the artifact itself" in system
    assert "never a plan, an outline or notes" in system
