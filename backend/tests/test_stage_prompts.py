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


def test_list_stage_tells_the_model_each_fields_length_limit(basic_inputs, list_stage, digest):
    """The screen caps "who" at 160 characters. Without the limit in the prompt
    the model wrote 212-249, which arrived clipped and flagged red."""
    schema = StageItemSchema(
        item_label="audience segment",
        fields=[
            StageItemField(key="who", label="Who they are", max_chars=160),
            StageItemField(key="prior_knowledge", label="What they already know"),
        ],
    )
    system, _user = build_stage_prompt(basic_inputs, list_stage, digest, schema)
    who_line = next(line for line in system.splitlines() if line.startswith("- who:"))
    assert "At most 160 characters." in who_line
    prior_line = next(line for line in system.splitlines() if line.startswith("- prior_knowledge:"))
    assert "At most" not in prior_line


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
async def test_a_table_has_room_for_every_row(basic_inputs, list_stage, digest, audience_schema):
    """A 12-row revision ran past 2048 tokens: the JSON was cut off and the
    revision "came back empty" (4 Oct, Options)."""
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({"items": []}, {}))
    await generate_stage_artifact(client, None, basic_inputs, list_stage, digest, audience_schema)
    assert client.generate_json.call_args.kwargs["max_tokens"] >= 8192


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


def test_stages_after_drafting_read_the_manuscript_itself(basic_inputs, digest, audience_schema):
    """Continuity, critique and fact-check exist to read the book. Given only the
    320-character stage summaries they reviewed the summaries — "the draft
    material provided is incomplete" — and fact-checked the objective."""
    stage = StageDescriptor(id="continuity", label="Continuity", renderer="review")
    with_book = digest.model_copy(update={"manuscript": "## Chapter 1\n\nCHAPTER-ONE-PROSE-MARKER"})
    _system, user = build_stage_prompt(basic_inputs, stage, with_book, audience_schema)
    assert "THE MANUSCRIPT AS DRAFTED" in user
    assert "CHAPTER-ONE-PROSE-MARKER" in user


def test_stages_before_drafting_carry_no_manuscript_block(basic_inputs, prose_stage, digest):
    _system, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "THE MANUSCRIPT AS DRAFTED" not in user


# --- A6 (Sean, 28 Sep, item 12): a model's status is a suggestion, never a verdict --


@pytest.fixture
def claim_schema() -> StageItemSchema:
    return StageItemSchema(
        item_label="claim",
        min_items=3,
        max_items=20,
        fields=[
            StageItemField(key="claim", label="Claim"),
            StageItemField(key="source", label="Source"),
            StageItemField(key="where", label="Where it appears"),
        ],
    )


def test_a_remove_status_is_stored_as_removed(claim_schema):
    items = _parse_items(
        {"items": [{"claim": "a", "status": "remove", "reason": "Not a real claim"}]},
        claim_schema,
    )
    dumped = items[0].model_dump()
    assert dumped["status"] == "removed"
    assert dumped["reason"] == "Not a real claim"


def test_a_model_cannot_mark_a_claim_verified(claim_schema):
    # Nothing here retrieved a source, so "verified" would be a guess wearing
    # the author's badge. It becomes provenance: a candidate source, at most.
    items = _parse_items(
        {"items": [
            {"claim": "a", "source": "Merck Manual, ch. 3", "status": "Verified", "reason": "Merck says so"},
            {"claim": "b", "status": "unverifiable", "reason": "No primary source"},
            {"claim": "c", "source": "none found", "status": "verified_by_promptmaster"},
        ]},
        claim_schema,
    )
    assert items[0].model_dump()["status"] == "candidate_source"
    assert "reason" not in items[0].model_dump()
    assert items[1].model_dump()["status"] == "unverifiable"
    assert items[2].model_dump()["status"] == "no_source"


def test_a_claim_with_no_status_starts_as_provenance(claim_schema):
    # C3: what PromptMaster found, never a decision — candidate_source when it
    # named where to check, no_source when it could not.
    items = _parse_items(
        {"items": [{"claim": "a", "source": "WHO fact sheet on rabies"}, {"claim": "b", "source": ""}, {"claim": "c"}]},
        claim_schema,
    )
    assert [i.model_dump()["status"] for i in items] == ["candidate_source", "no_source", "no_source"]


def test_other_tables_keep_whatever_status_the_model_sent(audience_schema):
    items = _parse_items({"items": [{"who": "a", "status": "verified"}]}, audience_schema)
    assert items[0].model_dump()["status"] == "verified"


# --- B0: a revision instruction reaches the model -----------------------------


def test_a_revision_instruction_reaches_the_user_prompt(basic_inputs, prose_stage, digest):
    _, user = build_stage_prompt(
        basic_inputs, prose_stage, digest, existing_content="The old draft.", instruction="Cut the second paragraph."
    )
    assert "REVISION INSTRUCTION" in user
    assert "Cut the second paragraph." in user
    # After the draft it applies to, so the model reads the text before the ask.
    assert user.index("The old draft.") < user.index("Cut the second paragraph.")


def test_no_instruction_means_no_instruction_block(basic_inputs, prose_stage, digest):
    _, user = build_stage_prompt(basic_inputs, prose_stage, digest, existing_content="The old draft.")
    assert "REVISION INSTRUCTION" not in user


# --- 1 Oct, items 3, 12 and 18: what the draft knows reaches the structured field ---

from promptmaster.schemas import StageItemField as _Field, StageItemStatus as _Status  # noqa: E402


def _runs_schema() -> StageItemSchema:
    return StageItemSchema(
        item_label="run",
        fields=[_Field(key="run", label="What was to be done"), _Field(key="observed", label="What actually happened")],
        statuses=[
            _Status(value="completed", label="Completed"),
            _Status(value="deviated", label="Deviated", requires_reason=True),
            _Status(value="not_run", label="Not run", requires_reason=True, model_may_set=True),
        ],
    )


def test_the_prompt_tells_the_draft_what_each_validation_status_certifies(basic_inputs, digest):
    """2 Oct, item 12: rows read "Reproduced" over text that said nothing had been
    recalculated. The draft is told what each status means, so what it writes
    lets the user pick honestly."""
    schema = StageItemSchema(
        item_label="result",
        fields=[_Field(key="result", label="The result"), _Field(key="attempt", label="What was done to validate it")],
        statuses=[
            _Status(value="independently_reproduced", label="Independently reproduced", explain="The result was recalculated or re-run from the data and came out the same."),
            _Status(value="supported_by_prior", label="Supported by prior evidence", explain="It agrees with earlier studies or records. Nothing was recalculated."),
            _Status(value="not_attempted", label="Not attempted", requires_reason=True, model_may_set=True, explain="No validation was tried. Say why."),
        ],
    )
    stage = StageDescriptor(id="validation", label="Validation", renderer="review", entry_prompt_hint="", artifact_kind="validation_table")
    system, user = build_stage_prompt(basic_inputs, stage, digest, schema)
    text = system + user
    assert "never describe a comparison with earlier work or a consistency check as a reproduction or recalculation" in text
    assert "· Supported by prior evidence: It agrees with earlier studies or records. Nothing was recalculated." in text
    assert "You may set: 'not_attempted' (Not attempted)" in text
    assert "Never set 'independently_reproduced', 'supported_by_prior'" in text


def test_the_prompt_says_which_status_the_model_may_set_and_which_it_may_not(basic_inputs, digest):
    stage = StageDescriptor(id="experiment", label="Experiment", renderer="review", entry_prompt_hint="", artifact_kind="runs")
    system, user = build_stage_prompt(basic_inputs, stage, digest, _runs_schema())
    text = system + user
    assert "status: set it ONLY when the project already tells you the outcome" in text
    assert "'not_run' (Not run) — give the reason in 'reason'" in text
    assert "Never set 'completed', 'deviated'" in text
    assert '"status": "(only if already known: not_run)"' in text


def test_a_run_the_model_knows_was_not_run_arrives_with_its_reason_marked_as_the_models():
    items = _parse_items(
        {"items": [{"id": "r1", "run": "Cohort extract", "status": "not_run", "reason": "No source data was provided."}]},
        _runs_schema(),
    )
    row = items[0].model_dump()
    assert row["status"] == "not_run"
    assert row["reason"] == "No source data was provided."
    assert row["status_source"] == "model"


def test_the_model_cannot_claim_a_run_was_completed_nor_skip_the_reason():
    items = _parse_items(
        {"items": [
            {"id": "r1", "run": "Cohort extract", "status": "completed"},
            {"id": "r2", "run": "Survival model", "status": "not_run", "reason": "  "},
            {"id": "r3", "run": "Ticket join", "status": "made_up", "status_source": "user"},
        ]},
        _runs_schema(),
    )
    for item in items:
        row = item.model_dump()
        assert "status" not in row
        assert "reason" not in row
        assert "status_source" not in row


def test_generated_rows_start_in_the_schemas_default_state(basic_inputs):
    schema = StageItemSchema(
        item_label="work",
        fields=[_Field(key="work", label="The work")],
        statuses=[
            _Status(value="candidate", label="Suggested by PromptMaster", model_default=True),
            _Status(value="retrieved", label="Retrieved"),
            _Status(value="verified", label="Verified by me"),
        ],
    )
    items = _parse_items({"items": [{"work": "Smith 2019", "status": "verified"}, {"work": "Lee 2021"}]}, schema)
    assert [i.model_dump()["status"] for i in items] == ["candidate", "candidate"]
    system, user = build_stage_prompt(
        basic_inputs,
        StageDescriptor(id="literature", label="Literature", renderer="list", entry_prompt_hint="", artifact_kind="literature_map"),
        StageDigest(), schema,
    )
    # Nothing the model may set: it is not asked about status at all.
    assert "status:" not in system + user


def test_a_client_that_sends_no_statuses_is_parsed_as_before(audience_schema):
    items = _parse_items({"items": [{"who": "a", "status": "accepted"}]}, audience_schema)
    assert items[0].model_dump()["status"] == "accepted"


def test_a_stage_is_told_what_data_the_project_holds(basic_inputs, prose_stage):
    from promptmaster.schemas import DataFileBrief

    digest = StageDigest(objective="o", data_files=[
        DataFileBrief(name="tickets.csv", columns=["account_id", "opened_at"], sample=[["A1", "2026-01-04"]], rows=88),
    ])
    _, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "DATA THE PROJECT HOLDS — files attached by the user" in user
    assert "- /data/tickets.csv — 88 rows; columns: account_id, opened_at" in user
    assert "do not state any result from them unless it is given to you elsewhere" in user


def test_a_stage_with_no_data_is_told_there_is_none(basic_inputs, prose_stage):
    _, user = build_stage_prompt(basic_inputs, prose_stage, StageDigest(objective="o"))
    assert "DATA THE PROJECT HOLDS: none" in user
    assert "Do not write as though any data had been examined" in user


# --- 2 Oct: the objective "changes" after the first stage ---------------------


def test_every_stage_is_told_the_original_objective_governs(basic_inputs, prose_stage):
    """The first stage's statement sat beside the original objective with
    nothing saying which wins, and "write a book about lions" drifted into
    whatever the statement made of it."""
    digest = StageDigest(objective="Write a book about lions", prior_stages=[
        StageDigestEntry(stage_id="objective", label="Objective and purpose", summary="A field guide to big cats."),
    ])
    _, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "THE ORIGINAL OBJECTIVE IS THE USER'S OWN WORDS AND GOVERNS." in user
    assert "Where an earlier stage above and the original objective disagree, the original objective wins." in user
    assert user.index("Original objective: Write a book about lions") < user.index("GOVERNS")
    # Only the objective-stating stage is told it is sharpening.
    assert "keeps the deliverable and the subject exactly as the user named them" not in user


@pytest.mark.parametrize("kind", ["objective_statement", "research_question"])
def test_the_objective_stage_sharpens_and_does_not_replace(basic_inputs, kind):
    stage = StageDescriptor(id="objective", label="Objective and purpose", renderer="prose",
                            entry_prompt_hint="Produce a statement of what this book is for.", artifact_kind=kind)
    _, user = build_stage_prompt(basic_inputs, stage, StageDigest(objective="Write a book about lions"))
    assert "This stage's statement sharpens the user's objective; it keeps the deliverable and the subject exactly as the user named them." in user


def test_later_stages_are_named_as_out_of_scope(basic_inputs, prose_stage, digest):
    """A Diagnosis draft wrote much of the Options and the 12-month plan (4 Oct)."""
    scoped = digest.model_copy(update={"later_stages": ["Turnaround options", "12-month plan"]})
    _system, user = build_stage_prompt(basic_inputs, prose_stage, scoped)
    assert "LATER STAGES (out of scope here): Turnaround options, 12-month plan" in user
    _system, user = build_stage_prompt(basic_inputs, prose_stage, digest)
    assert "LATER STAGES" not in user


# --- 3 Oct (Research run): the draft proposes the status its own text supports ---


def _alternatives_schema() -> StageItemSchema:
    return StageItemSchema(
        item_label="alternative explanation",
        fields=[_Field(key="explanation", label="The rival explanation"), _Field(key="how_addressed", label="What rules it out")],
        statuses=[
            _Status(value="ruled_out", label="Ruled out", model_may_propose=True),
            _Status(value="addressed", label="Addressed", model_may_propose=True),
            _Status(value="left_open", label="Left open", requires_reason=True, model_may_propose=True),
        ],
    )


def test_the_prompt_asks_for_a_proposed_status_and_reason_on_every_row(basic_inputs, digest):
    stage = StageDescriptor(id="alternatives", label="Alternatives", renderer="review", entry_prompt_hint="", artifact_kind="alternatives")
    system, user = build_stage_prompt(basic_inputs, stage, digest, _alternatives_schema())
    text = system + user
    assert "for EVERY row, propose the one status its own text supports: 'ruled_out' (Ruled out); 'addressed' (Addressed); 'left_open' (Left open)" in text
    assert "a proposal the user will confirm or change" in text
    assert "never a stronger status than the text supports" in text
    assert '"status": "(the status this row\'s text supports: ruled_out or addressed or left_open)"' in text
    assert "Never set" not in text


def test_validation_proposes_judgments_but_never_a_reproduction(basic_inputs, digest):
    schema = StageItemSchema(
        item_label="result",
        fields=[_Field(key="result", label="The result")],
        statuses=[
            _Status(value="independently_reproduced", label="Independently reproduced"),
            _Status(value="supported_by_prior", label="Supported by prior evidence", model_may_propose=True),
            _Status(value="consistency_check", label="Consistency check only", model_may_propose=True),
            _Status(value="not_attempted", label="Not attempted", requires_reason=True, model_may_set=True),
        ],
    )
    stage = StageDescriptor(id="validation", label="Validation", renderer="review", entry_prompt_hint="", artifact_kind="validation_table")
    system, user = build_stage_prompt(basic_inputs, stage, digest, schema)
    text = system + user
    assert "'not_attempted' (Not attempted); 'supported_by_prior' (Supported by prior evidence); 'consistency_check' (Consistency check only)" in text
    assert "Never set 'independently_reproduced'" in text
    items = _parse_items(
        {"items": [
            {"id": "v1", "result": "Margin fell 6 points", "status": "consistency_check", "reason": "Checked against earlier stages only."},
            {"id": "v2", "result": "Scrap rose", "status": "independently_reproduced", "reason": "Recalculated."},
            {"id": "v3", "result": "Mix shift", "status": "not_attempted", "reason": "No SKU data."},
        ]},
        schema,
    )
    rows = [i.model_dump() for i in items]
    assert rows[0]["status"] == "consistency_check" and rows[0]["status_source"] == "proposed"
    assert rows[0]["reason"] == "Checked against earlier stages only."
    # Never the model's to claim, not even as a proposal.
    assert "status" not in rows[1] and "status_source" not in rows[1]
    # An outcome it may set still counts as set.
    assert rows[2]["status"] == "not_attempted" and rows[2]["status_source"] == "model"


def test_a_proposal_that_needs_a_reason_and_has_none_is_dropped():
    items = _parse_items(
        {"items": [
            {"id": "a1", "explanation": "Raw-material inflation", "status": "left_open", "reason": ""},
            {"id": "a2", "explanation": "Measurement artefact", "status": "Addressed", "reason": "Reconciled to the ledger."},
        ]},
        _alternatives_schema(),
    )
    rows = [i.model_dump() for i in items]
    assert "status" not in rows[0]
    assert rows[1]["status"] == "addressed" and rows[1]["status_source"] == "proposed"


# --- 3 Oct (Single Output): the prompt and the deliverable are separate artifacts ---


def test_a_prompt_stage_writes_the_instruction_not_the_deliverable(basic_inputs, digest):
    stage = StageDescriptor(id="review", label="Review the prompt", renderer="prose", entry_prompt_hint="", artifact_kind="prompt")
    system, _ = build_stage_prompt(basic_inputs, stage, digest)
    assert "THIS STAGE'S ARTIFACT IS A PROMPT" in system
    assert "Do NOT write the deliverable itself" in system
    output = StageDescriptor(id="output", label="Output", renderer="prose", entry_prompt_hint="", artifact_kind="output")
    assert "ARTIFACT IS A PROMPT" not in build_stage_prompt(basic_inputs, output, digest)[0]


def test_the_deliverable_is_produced_from_the_reviewed_prompt(basic_inputs, digest):
    stage = StageDescriptor(id="output", label="Output and evaluation", renderer="prose", entry_prompt_hint="", artifact_kind="output")
    reviewed = digest.model_copy(update={"reviewed_prompt": "Write an internal audit memo on vendor payments: findings, risk ratings, actions."})
    _, user = build_stage_prompt(basic_inputs, stage, reviewed)
    assert "THE REVIEWED PROMPT" in user
    assert "--- BEGIN PROMPT ---\nWrite an internal audit memo on vendor payments" in user
    _, without = build_stage_prompt(basic_inputs, stage, digest)
    assert "THE REVIEWED PROMPT" not in without
