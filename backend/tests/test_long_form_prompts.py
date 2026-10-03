"""Tests for long-form schemas and prompt builders."""
from __future__ import annotations

import pytest

from promptmaster.schemas import (
    DetectLongFormResponse,
    GenerateOutlineResponse,
    GenerateSectionResponse,
    LongFormState,
    OutlineSection,
)


def test_outline_section_defaults():
    section = OutlineSection(id="s1", title="Intro", abstract="Sets the stage.")
    assert section.status == "pending"
    assert section.content == ""
    assert section.revision == 0
    assert section.finish_reason is None
    assert section.error is None
    assert section.generated_at is None


def test_outline_section_all_fields_roundtrip():
    section = OutlineSection(
        id="s1",
        title="Body",
        abstract="The middle of the document.",
        status="complete",
        content="Generated prose here.",
        revision=2,
        finish_reason="stop",
        error=None,
        generated_at="2026-05-28T10:00:00Z",
    )
    assert section.model_dump()["status"] == "complete"
    assert OutlineSection(**section.model_dump()) == section


def test_long_form_state_defaults():
    state = LongFormState(state="outlining", started_at="2026-05-28T10:00:00Z")
    assert state.current_section_index == -1
    assert state.outline == []
    assert state.continuity_snapshot is None
    assert state.completed_at is None


def test_detect_response_required_fields():
    r = DetectLongFormResponse(is_long_form=True, suggested_section_count=10, reason="...")
    assert r.is_long_form is True
    assert r.suggested_section_count == 10


def test_generate_outline_response_holds_sections():
    r = GenerateOutlineResponse(outline=[
        OutlineSection(id="s1", title="A", abstract="a"),
        OutlineSection(id="s2", title="B", abstract="b"),
    ])
    assert len(r.outline) == 2


def test_generate_section_response_shape():
    from promptmaster.schemas import ContinuitySnapshot
    r = GenerateSectionResponse(
        content="prose",
        finish_reason="stop",
        new_snapshot=ContinuitySnapshot(),
    )
    assert r.finish_reason == "stop"
    assert r.new_snapshot is not None


# Detect long-form tests
from unittest.mock import AsyncMock
from promptmaster.long_form import build_detect_prompt, detect_long_form


def test_build_detect_prompt_includes_objective(basic_inputs):
    system, user = build_detect_prompt(basic_inputs)
    assert "objective" in user.lower()
    assert basic_inputs.objective in user


async def test_detect_returns_response_when_llm_says_long_form(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {"is_long_form": True, "suggested_section_count": 12, "reason": "Multi-section BRD"},
        {},
    ))
    result = await detect_long_form(client, model=None, inputs=basic_inputs)
    assert result.is_long_form is True
    assert result.suggested_section_count == 12
    assert "BRD" in result.reason


async def test_detect_returns_negative_when_llm_says_short(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {"is_long_form": False, "suggested_section_count": 0, "reason": "Short ask"},
        {},
    ))
    result = await detect_long_form(client, model=None, inputs=basic_inputs)
    assert result.is_long_form is False


async def test_detect_falls_back_to_negative_on_llm_error(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(side_effect=Exception("LLM down"))
    result = await detect_long_form(client, model=None, inputs=basic_inputs)
    assert result.is_long_form is False
    assert result.suggested_section_count == 0


# Outline generation tests
from promptmaster.long_form import build_outline_prompt, generate_outline


def test_build_outline_prompt_includes_section_count(basic_inputs):
    system, user = build_outline_prompt(basic_inputs, suggested_section_count=8)
    assert "8" in user
    assert basic_inputs.objective in user


async def test_generate_outline_parses_sections(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {"outline": [
            {"title": "Intro", "abstract": "Sets the stage."},
            {"title": "Body", "abstract": "Develops the argument."},
            {"title": "Conclusion", "abstract": "Wraps up."},
        ]},
        {},
    ))
    sections = await generate_outline(client, model=None, inputs=basic_inputs, suggested_section_count=3)
    assert len(sections) == 3
    assert sections[0].title == "Intro"
    assert sections[0].status == "pending"
    assert sections[0].content == ""
    assert sections[0].revision == 0
    assert sections[0].id  # auto-generated, non-empty


async def test_generate_outline_assigns_unique_ids(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {"outline": [
            {"title": "A", "abstract": "a"},
            {"title": "B", "abstract": "b"},
        ]},
        {},
    ))
    sections = await generate_outline(client, model=None, inputs=basic_inputs, suggested_section_count=2)
    assert sections[0].id != sections[1].id


async def test_generate_outline_handles_malformed_response(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({"outline": "not a list"}, {}))
    with pytest.raises(ValueError):
        await generate_outline(client, model=None, inputs=basic_inputs, suggested_section_count=3)


# Section generation tests
from promptmaster.long_form import build_section_prompt, generate_section
from promptmaster.schemas import ContinuitySnapshot


def test_build_section_prompt_includes_target_section(basic_inputs):
    outline = [
        OutlineSection(id="s1", title="Intro", abstract="Sets the stage."),
        OutlineSection(id="s2", title="Body", abstract="Develops the argument."),
        OutlineSection(id="s3", title="Conclusion", abstract="Wraps up."),
    ]
    system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=outline,
        section_index=1,
        prior_snapshot=None,
        prev_section_content="",
    )
    assert "Body" in user
    assert "Develops the argument" in user
    assert "Intro" in user  # full outline visible
    assert "Conclusion" in user  # full outline visible


def test_build_section_prompt_includes_prev_section_when_present(basic_inputs):
    outline = [
        OutlineSection(id="s1", title="Intro", abstract="Sets the stage."),
        OutlineSection(id="s2", title="Body", abstract="Develops the argument."),
    ]
    system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=outline,
        section_index=1,
        prior_snapshot=ContinuitySnapshot(
            completed_topics=["Intro"],
            current_topic=None,
            key_definitions=["AI workflow"],
            next_topic_hint="Body",
        ),
        prev_section_content="The previous section's prose here.",
    )
    assert "The previous section's prose here." in user
    assert "AI workflow" in user
    assert "Intro" in user


async def test_generate_section_returns_content_and_snapshot(basic_inputs):
    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("Generated body prose.", {}, "stop"))
    # Mock the snapshot generation by patching the imported function
    client.generate_json = AsyncMock(return_value=(
        {"completed_topics": ["Intro", "Body"], "current_topic": None, "key_definitions": [], "next_topic_hint": "Conclusion"},
        {},
    ))

    outline = [
        OutlineSection(id="s1", title="Intro", abstract="x", status="complete", content="Intro prose."),
        OutlineSection(id="s2", title="Body", abstract="y"),
    ]
    result = await generate_section(
        client=client,
        model=None,
        inputs=basic_inputs,
        outline=outline,
        section_index=1,
        prior_snapshot=None,
        prev_section_content="Intro prose.",
    )
    assert result.content == "Generated body prose."
    assert result.finish_reason == "stop"
    assert result.new_snapshot.next_topic_hint == "Conclusion"


async def test_generate_section_propagates_length_finish_reason(basic_inputs):
    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("Truncated...", {}, "length"))
    client.generate_json = AsyncMock(return_value=(
        {"completed_topics": [], "current_topic": "Body", "key_definitions": [], "next_topic_hint": None},
        {},
    ))
    outline = [OutlineSection(id="s1", title="Body", abstract="y")]
    result = await generate_section(
        client=client,
        model=None,
        inputs=basic_inputs,
        outline=outline,
        section_index=0,
        prior_snapshot=None,
        prev_section_content="",
    )
    assert result.finish_reason == "length"


def test_a_section_is_told_to_say_each_thing_once(basic_inputs):
    """1 Oct, item 31: one point repeated across Results, Validation, Discussion, Threats and Conclusion."""
    outline = [
        OutlineSection(id="s1", title="What was found", abstract="Each finding once."),
        OutlineSection(id="s2", title="What to do next", abstract="The actions that follow."),
    ]
    _, user = build_section_prompt(inputs=basic_inputs, outline=outline, section_index=1, prior_snapshot=None, prev_section_content="")
    assert "SAY EACH THING ONCE" in user
    assert "Do not restate a finding, a figure, a caveat or a recommendation that an earlier section has made" in user
    assert "write only what is new here" in user


def test_a_section_is_told_to_keep_a_short_report_short_and_to_report_only_what_is_on_record(basic_inputs):
    from promptmaster.long_form import build_section_prompt
    from promptmaster.schemas import OutlineSection

    outline = [
        OutlineSection(id="answer", title="The answer", abstract="Lead with the answer, in a few sentences."),
        OutlineSection(id="findings", title="What was found", abstract="Experiment: no run was carried out; the data was not provided."),
    ]
    _, user = build_section_prompt(basic_inputs, outline, 1, None, "")
    assert "LENGTH. Keep to any length the constraints or this section's brief give." in user
    assert "roughly 150 to 300 words" in user
    assert "Never pad a section to look thorough." in user
    assert "REPORT ONLY WHAT IS ON RECORD." in user
    assert "Never write that a pattern, a number or a finding was observed unless the brief or the prior context states it." in user
    # The brief that says nothing was run reaches the model with that instruction beside it.
    assert "no run was carried out; the data was not provided" in user


# --- 2 Oct: "it really wants to make outlines" -------------------------------


def _book_outline():
    return [
        OutlineSection(id="s1", title="Habitat", abstract="Where lions live."),
        OutlineSection(id="s2", title="Diet", abstract="What lions eat."),
    ]


def test_a_section_takes_the_mode_as_a_voice_not_a_scaffold(basic_inputs):
    """Architect's lock ("You do not write final prose — you build scaffolding")
    reached every chapter prompt beside "Do NOT outline", and the chapters came
    out as outlines."""
    from promptmaster.long_form import build_section_prompt

    inputs = basic_inputs.model_copy(update={"mode": "architect"})
    system, _ = build_section_prompt(inputs, _book_outline(), 0, None, "")
    assert "You do not write final prose" not in system
    assert "scaffold-first" not in system
    assert "[INTERNAL SCAFFOLDING]" not in system
    assert "MODE: Architect." in system
    assert "TONE GUIDANCE: Neutral, strategic" in system
    assert "a mode's structural habits — scaffolds, headings, numbered sub-plans" in system
    assert "Headings, bullet scaffolds and numbered sub-plans are wrong here" in system
    # The self-model still travels with it.
    from tests.test_self_model import _assert_self_model
    _assert_self_model(system)


def test_a_custom_persona_keeps_its_preamble_in_a_section(basic_inputs):
    from promptmaster.long_form import build_section_prompt

    inputs = basic_inputs.model_copy(update={
        "mode": "custom", "custom_name": "Grandmother", "custom_preamble": "You tell it like a bedtime story.",
        "custom_tone": "Warm, unhurried.",
    })
    system, _ = build_section_prompt(inputs, _book_outline(), 0, None, "")
    assert "MODE: Grandmother." in system
    assert "You tell it like a bedtime story." in system
    assert "TONE GUIDANCE: Warm, unhurried." in system
    assert "[INTERNAL SCAFFOLDING]" not in system


def test_the_drafting_stage_s_hint_reaches_the_section_prompt(basic_inputs):
    from promptmaster.long_form import build_section_prompt, build_section_revision_prompt
    from promptmaster.schemas import SectionRevisionBrief

    hint = "Write to the audience segments as described: assume what they already know."
    system, _ = build_section_prompt(basic_inputs, _book_outline(), 0, None, "", stage_hint=hint)
    assert f"THIS STAGE:\n{hint}" in system
    plain, _ = build_section_prompt(basic_inputs, _book_outline(), 0, None, "")
    assert "THIS STAGE:" not in plain

    revision = SectionRevisionBrief(stage_label="Revision", instruction="Tighten it.", notes="", current_content="Old text.")
    rev_system, _ = build_section_revision_prompt(basic_inputs, _book_outline(), 0, revision, stage_hint=hint)
    assert f"THIS STAGE:\n{hint}" in rev_system
    assert "[INTERNAL SCAFFOLDING]" not in rev_system
