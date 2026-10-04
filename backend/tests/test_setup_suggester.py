"""Tests for the Smart Setup suggestion LLM helper."""

from unittest.mock import AsyncMock

import pytest

from promptmaster.setup_suggester import (
    SETUP_SUGGESTER_SYSTEM,
    build_setup_prompt,
    suggest_setup,
)
from promptmaster.schemas import SetupSuggestion


def test_build_setup_prompt_includes_objective():
    prompt = build_setup_prompt(objective="Plan a launch strategy")
    assert "Plan a launch strategy" in prompt


def test_build_setup_prompt_asks_for_all_five_fields():
    prompt = build_setup_prompt(objective="x")
    for field in ("mode", "audience", "constraints", "output_format", "rationale"):
        assert field in prompt


def test_setup_suggester_system_lists_available_modes():
    for mode in (
        "architect", "critic", "clarity", "coach",
        "therapist", "cold_critic", "analyst",
    ):
        assert mode in SETUP_SUGGESTER_SYSTEM


def test_setup_suggester_system_excludes_custom_mode():
    """Smart Setup must not recommend the 'custom' mode."""
    lower = SETUP_SUGGESTER_SYSTEM.lower()
    assert "custom" in lower
    assert "do not recommend" in lower or "do not suggest" in lower


@pytest.mark.asyncio
async def test_suggest_setup_returns_parsed_suggestion():
    client = AsyncMock()
    fake_json = {
        "mode": "architect",
        "audience": "Engineering Leads",
        "constraints": "Two-week timeline",
        "output_format": "Numbered list",
        "rationale": {
            "mode": "Best for structured plans",
            "audience": "Matches the framing",
            "constraints": "Adds a deadline",
            "output_format": "Scannable structure",
        },
    }
    client.generate_json = AsyncMock(return_value=(fake_json, {}))

    result = await suggest_setup(client=client, model=None, objective="Plan a launch")
    assert isinstance(result, SetupSuggestion)
    assert result.mode == "architect"
    assert result.audience == "Engineering Leads"
    assert result.rationale.mode == "Best for structured plans"
    client.generate_json.assert_called_once()


@pytest.mark.asyncio
async def test_suggest_setup_falls_back_to_architect_on_invalid_mode():
    """Defensive parsing: unknown mode -> architect."""
    client = AsyncMock()
    fake_json = {
        "mode": "nonsense_mode",
        "audience": "General",
        "constraints": "",
        "output_format": "",
        "rationale": {},
    }
    client.generate_json = AsyncMock(return_value=(fake_json, {}))

    result = await suggest_setup(client=client, model=None, objective="x")
    assert result.mode == "architect"


@pytest.mark.asyncio
async def test_suggest_setup_handles_missing_optional_fields():
    """Defensive parsing: missing audience/constraints/format/rationale all default."""
    client = AsyncMock()
    fake_json = {"mode": "architect"}
    client.generate_json = AsyncMock(return_value=(fake_json, {}))

    result = await suggest_setup(client=client, model=None, objective="x")
    assert result.mode == "architect"
    assert result.audience == "General"
    assert result.constraints == ""
    assert result.output_format == ""
    assert result.rationale.mode == ""


# --- PM-09: unified entry ------------------------------------------------------

from promptmaster.schemas import GuideAnswer  # noqa: E402
from promptmaster.setup_suggester import (  # noqa: E402
    GUIDE_QUESTIONS_SYSTEM,
    build_guide_questions_prompt,
    suggest_guide_questions,
)


def test_setup_asks_for_a_workflow_with_a_reason():
    """The user should not have to know Book / Research / Single output first."""
    assert "book|research|single_output" in build_setup_prompt("x")
    assert "workflow_reason" in build_setup_prompt("x")
    assert "smallest workflow that fits" in SETUP_SUGGESTER_SYSTEM


def test_guided_answers_reach_the_setup_prompt():
    prompt = build_setup_prompt(
        "A book about giraffes",
        [GuideAnswer(question="Who is this for?", answer="Ten-year-olds")],
    )
    assert "Who is this for? Ten-year-olds" in prompt


@pytest.mark.asyncio
async def test_invalid_workflow_falls_back_to_single_output():
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({"mode": "architect", "workflow": "novel"}, {}))
    s = await suggest_setup(client=client, model=None, objective="x")
    assert s.workflow == "single_output"


@pytest.mark.asyncio
async def test_workflow_and_reason_are_returned():
    client = AsyncMock()
    client.generate_json = AsyncMock(
        return_value=({"mode": "clarity", "workflow": "book", "workflow_reason": "Chapters."}, {})
    )
    s = await suggest_setup(client=client, model=None, objective="x")
    assert (s.workflow, s.workflow_reason) == ("book", "Chapters.")


def test_guide_questions_prompt_is_about_setting_the_work_up():
    assert "Never ask something the objective already answers" in GUIDE_QUESTIONS_SYSTEM
    assert "Objective: learn Rust" in build_guide_questions_prompt("learn Rust")


@pytest.mark.asyncio
async def test_guide_questions_are_capped_cleaned_and_have_a_fallback():
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({"questions": [
        {"question": "Who for?", "options": ["a", "b", "c", "d", "e"]},
        {"question": ""},
        "junk",
    ]}, {}))
    qs = await suggest_guide_questions(client=client, model=None, objective="x")
    assert [q.question for q in qs] == ["Who for?"]
    assert len(qs[0].options) == 4

    client.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    fallback = await suggest_guide_questions(client=client, model=None, objective="x")
    assert len(fallback) == 3


def test_output_format_guidance_names_manuscript_prose_for_a_book():
    """2 Oct: "it really wants to make outlines" — the suggested format for a
    book was one of the structural examples, and every chapter was told to
    produce it."""
    from promptmaster.setup_suggester import SETUP_SUGGESTER_SYSTEM

    assert "For a book (workflow book) that is manuscript prose" in SETUP_SUGGESTER_SYSTEM
    assert "never an outline, a list or a table: the outline is scaffolding, not the product" in SETUP_SUGGESTER_SYSTEM
    assert "pick the mode for the finished prose instead" in SETUP_SUGGESTER_SYSTEM


@pytest.mark.asyncio
async def test_an_exploration_recommendation_is_kept_and_valid():
    """3 Oct production: the suggester recommended "exploration", the schema
    allowed only three workflows, and /api/generate-setup returned 500."""
    from unittest.mock import AsyncMock

    from promptmaster.setup_suggester import suggest_setup

    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({
        "mode": "architect", "audience": "General", "constraints": "", "output_format": "Free-form prose",
        "workflow": "exploration", "workflow_reason": "Open-ended idea.",
        "rationale": {"mode": "", "audience": "", "constraints": "", "output_format": ""},
    }, {}))
    suggestion = await suggest_setup(client=client, model=None, objective="Is spacetime emergent?")
    assert suggestion.workflow == "exploration"
