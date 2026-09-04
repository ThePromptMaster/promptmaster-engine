"""Stage artifact prompt builders, tested without an LLM.

The point of keeping `build_stage_prompt` pure is exactly this: the two things
that make stage generation work — the stage's authored instruction reaching the
system prompt, and the upstream digest reaching the user prompt — are asserted
here at zero cost and with no network.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from promptmaster.schemas import (
    StageDescriptor,
    StageDigest,
    StageDigestEntry,
    StageItemField,
    StageItemSchema,
)
from promptmaster.stage import _parse_items, build_stage_prompt, generate_stage_artifact


@pytest.fixture
def prose_stage() -> StageDescriptor:
    return StageDescriptor(
        id="positioning",
        label="Positioning",
        renderer="prose",
        entry_prompt_hint="Name the books this sits beside and say what it does that they do not.",
        artifact_kind="positioning_statement",
    )


@pytest.fixture
def list_stage() -> StageDescriptor:
    return StageDescriptor(
        id="audience",
        label="Audience",
        renderer="list",
        entry_prompt_hint="Produce distinct audience segments, not one blurred reader.",
        artifact_kind="audience_profile",
    )


@pytest.fixture
def audience_schema() -> StageItemSchema:
    return StageItemSchema(
        item_label="audience segment",
        min_items=2,
        max_items=4,
        fields=[
            StageItemField(key="who", label="Who this segment is"),
            StageItemField(key="prior_knowledge", label="What they already know"),
            StageItemField(key="what_they_want", label="What they want from the book"),
        ],
    )


@pytest.fixture
def digest() -> StageDigest:
    return StageDigest(
        objective="A field guide to governing AI-assisted work.",
        audience="Engineering leads",
        prior_stages=[
            StageDigestEntry(
                stage_id="objective",
                label="Objective and purpose",
                summary="Give teams a defensible way to govern AI-written work.",
            )
        ],
    )


# --- the instruction seam ---------------------------------------------------

def test_entry_prompt_hint_reaches_the_system_prompt(basic_inputs, prose_stage, digest):
    system, _user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert prose_stage.entry_prompt_hint in system
    assert "Positioning" in system


def test_system_prompt_still_carries_the_mode_scaffolding(basic_inputs, prose_stage, digest):
    """The stage instruction is appended to build_prompt's system prompt, not
    substituted for it — a stage must not silently drop the selected mode."""
    system, _user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "PromptMaster Engine" in system
    assert "Session history:" in system


def test_a_stage_with_no_hint_still_builds(basic_inputs, digest):
    stage = StageDescriptor(id="editing", label="Editing", renderer="prose")
    system, user = build_stage_prompt(basic_inputs, stage, digest)
    assert "STAGE MODE" in system
    assert "Editing" in user


# --- the digest seam --------------------------------------------------------

def test_digest_reaches_the_user_prompt(basic_inputs, prose_stage, digest):
    _system, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "Give teams a defensible way to govern AI-written work." in user
    assert "Objective and purpose" in user
    assert digest.objective in user


def test_digest_objective_wins_over_pminput(basic_inputs, prose_stage, digest):
    """The client owns the project's objective text; PMInput is the fallback."""
    _system, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert digest.objective in user
    assert f"Original objective: {basic_inputs.objective}" not in user


def test_empty_digest_says_so_rather_than_going_silent(basic_inputs, prose_stage):
    _system, user = build_stage_prompt(basic_inputs, prose_stage, StageDigest())
    assert "(nothing completed before this stage)" in user


def test_digest_is_bounded_by_stage_count(basic_inputs, prose_stage):
    """One line per prior stage: the prompt grows with stages, not with words
    written. This is the property that keeps a 13-stage book affordable."""
    many = StageDigest(
        objective="o",
        prior_stages=[
            StageDigestEntry(stage_id=f"s{i}", label=f"Stage {i}", summary="x" * 200)
            for i in range(12)
        ],
    )
    _system, user = build_stage_prompt(basic_inputs, prose_stage, many)
    assert user.count("Stage ") >= 12


# --- list stages ------------------------------------------------------------

def test_list_stage_states_the_shape_in_the_system_prompt(
    basic_inputs, list_stage, digest, audience_schema
):
    system, _user = build_stage_prompt(basic_inputs, list_stage, digest, audience_schema)
    for key in ("who", "prior_knowledge", "what_they_want"):
        assert key in system
    assert '{ "items": [ ... ] }' in system


def test_list_stage_restates_the_shape_as_a_literal_example(
    basic_inputs, list_stage, digest, audience_schema
):
    """Stating the shape once is not enough — the idiom that actually holds the
    format is the literal example in the user message."""
    _system, user = build_stage_prompt(basic_inputs, list_stage, digest, audience_schema)
    assert '"items"' in user
    assert '"who"' in user
    assert "between 2 and 4 audience segments" in user


def test_review_renderer_generates_items_not_prose(basic_inputs, digest, audience_schema):
    stage = StageDescriptor(id="fact_check", label="Fact-check", renderer="review")
    _system, user = build_stage_prompt(basic_inputs, stage, digest, audience_schema)
    assert '"items"' in user


def test_regeneration_shows_the_model_what_it_is_replacing(basic_inputs, prose_stage, digest):
    _system, user = build_stage_prompt(
        basic_inputs, prose_stage, digest, existing_content="The current draft."
    )
    assert "The current draft." in user
    assert "do not repeat it verbatim" in user


# --- one endpoint, two workflows -------------------------------------------

def test_a_research_stage_uses_the_same_builder(basic_inputs, digest):
    """No branch anywhere reads which workflow a stage came from — a Research
    hypothesis stage differs from a Book audience stage only in its data."""
    stage = StageDescriptor(
        id="hypothesis",
        label="Hypothesis",
        renderer="list",
        entry_prompt_hint="State each hypothesis so it could be shown false.",
    )
    schema = StageItemSchema(
        item_label="hypothesis",
        fields=[
            StageItemField(key="statement", label="The claim"),
            StageItemField(key="prediction", label="What it predicts"),
            StageItemField(key="disconfirming_observation", label="What would falsify it"),
        ],
    )
    system, user = build_stage_prompt(basic_inputs, stage, digest, schema)
    assert "State each hypothesis so it could be shown false." in system
    assert '"disconfirming_observation"' in user


# --- defensive parsing ------------------------------------------------------

def test_malformed_rows_are_skipped_not_fatal(audience_schema):
    items = _parse_items(
        {"items": [{"who": "a"}, "not an object", 42, {"who": "b"}]}, audience_schema
    )
    assert len(items) == 2


def test_missing_ids_are_backfilled(audience_schema):
    items = _parse_items({"items": [{"who": "a"}, {"who": "b"}]}, audience_schema)
    ids = [i.id for i in items]
    assert all(ids) and len(set(ids)) == 2


def test_a_non_list_container_returns_empty_rather_than_raising(audience_schema):
    assert _parse_items({"items": "nope"}, audience_schema) == []
    assert _parse_items({}, audience_schema) == []


def test_undeclared_columns_are_dropped(audience_schema):
    items = _parse_items(
        {"items": [{"id": "i1", "who": "a", "invented_column": "x"}]}, audience_schema
    )
    assert not hasattr(items[0], "invented_column")
    assert items[0].model_dump()["who"] == "a"


def test_status_and_reason_survive_even_when_not_declared(audience_schema):
    """Review stages carry triage state alongside whatever the schema declares."""
    items = _parse_items(
        {"items": [{"id": "i1", "who": "a", "status": "verified", "reason": "checked"}]},
        audience_schema,
    )
    assert items[0].model_dump()["status"] == "verified"


# --- the call ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_prose_stage_returns_markdown(basic_inputs, prose_stage, digest):
    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("# Positioning\n\nText.", {}, "stop"))
    result = await generate_stage_artifact(client, None, basic_inputs, prose_stage, digest)
    assert result.content.startswith("# Positioning")
    assert result.items == []
    client.generate_json.assert_not_called()


@pytest.mark.asyncio
async def test_list_stage_returns_items(basic_inputs, list_stage, digest, audience_schema):
    client = AsyncMock()
    client.generate_json = AsyncMock(
        return_value=({"items": [{"id": "i1", "who": "Engineering leads"}]}, {})
    )
    result = await generate_stage_artifact(
        client, None, basic_inputs, list_stage, digest, audience_schema
    )
    assert len(result.items) == 1
    assert result.content == ""


@pytest.mark.asyncio
async def test_a_failed_list_call_degrades_to_an_empty_stage(
    basic_inputs, list_stage, digest, audience_schema
):
    """An editable empty stage with a Regenerate button beats an error page."""
    client = AsyncMock()
    client.generate_json = AsyncMock(side_effect=RuntimeError("boom"))
    result = await generate_stage_artifact(
        client, None, basic_inputs, list_stage, digest, audience_schema
    )
    assert result.items == []
    assert result.finish_reason == "error"
