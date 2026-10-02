"""Stage artifact generation — one endpoint for every stage of every workflow.

A Book project walks thirteen stages and each one has to produce something: an
objective statement, audience segments, a positioning statement, a claim table.
Until now nothing generated any of them, so a user could walk the whole workflow
and come out with an empty project.

Two deliberate choices shape this module:

1. **It reuses the seam that already exists.** `_shared_system(inputs, [], extra)`
   wraps the mode-locked system prompt with a trailing instruction, and every
   non-trivial generation path already goes through it — long-form sections,
   apply-audit, apply-to-answer. A stage's instruction is its template's
   `entry_prompt_hint`, passed as `extra`. No new prompt machinery.

2. **It does not run the full iteration pipeline.** That pipeline scores output
   against `inputs.objective`, which is the wrong question to ask of an Audience
   stage producing segments, needs a prose string, and costs four LLM calls per
   stage. `generate_section` already bypasses it for the same reasons; the
   pipeline belongs at the document boundary, not on every stage.

Prompt building is pure and separate from the call, so a stage's instruction can
be asserted without a model — see tests/test_stage_prompts.py.
"""

from __future__ import annotations

import json
import logging
import uuid

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import (
    format_data_files,
    GenerateStageArtifactResponse,
    PMInput,
    StageDescriptor,
    StageDigest,
    StageItem,
    StageItemSchema,
)

logger = logging.getLogger(__name__)


# The generic half of the instruction. The specific half is the stage's own
# entry_prompt_hint, which is where the workflow's voice lives.
_PROSE_INSTRUCTION = (
    "STAGE MODE: You are producing the artifact for ONE stage of a longer piece "
    "of structured work. Write only this stage's artifact. Do not preview what "
    "later stages will cover, do not restate the earlier stages back to the "
    "user, and do not add meta commentary about the process. Produce the "
    "artifact itself — the actual text this stage calls for, written in full — "
    "never a plan, an outline or notes about how it could be written. Return "
    "Markdown prose, no code fences around the whole answer."
)

_LIST_INSTRUCTION = (
    "STAGE MODE: You are producing the artifact for ONE stage of a longer piece "
    "of structured work, and this stage's artifact is a LIST of structured "
    "items rather than prose. Return JSON only. Do not add commentary before or "
    "after the JSON. Every item must be concrete and specific enough to be "
    "acted on — a list of generalities is worse than a short list."
)


def _format_digest(digest: StageDigest) -> str:
    """Render the upstream stages as a block the model can read in order."""
    if not digest.prior_stages:
        return "(nothing completed before this stage)"
    lines = []
    for entry in digest.prior_stages:
        label = entry.label or entry.stage_id
        summary = entry.summary.strip() or "(no summary recorded)"
        lines.append(f"- {label}: {summary}")
    return "\n".join(lines)


def _format_item_schema(schema: StageItemSchema) -> str:
    """State the item shape in words. The literal example is built separately."""
    if not schema.fields:
        return "Each item is an object with an 'id' and a 'text' field."
    lines = [
        "Each item is an object with these fields (plus an 'id' — a short unique string):"
    ]
    for field in schema.fields:
        label = field.label or field.key
        hint = f" {field.hint}" if field.hint else ""
        # The screen enforces this limit; a draft that overruns it arrives
        # clipped and flagged red before the user has touched it.
        limit = f" At most {field.max_chars} characters." if field.max_chars else ""
        lines.append(f"- {field.key}: {label}.{hint}{limit}".rstrip())
    explained = [s for s in schema.statuses if s.explain]
    if explained:
        # The user picks from these; the draft has to describe what was done
        # in terms that let them pick honestly (2 Oct, item 12: "validated
        # against earlier-cited studies" sat under a status reading "Reproduced").
        lines.append(
            "The user will give each row one of these statuses. Write each row so that it is plain which one applies — "
            "say what was actually done, and never describe a comparison with earlier work or a consistency check "
            "as a reproduction or recalculation:"
        )
        lines.extend(f"  · {s.label or s.value}: {s.explain}" for s in explained)
    settable = [s for s in schema.statuses if s.model_may_set]
    if settable:
        # What the draft already knows should not have to be typed in again by
        # the user (1 Oct, items 3 and 18) — but only the outcomes that are the
        # model's to state. The rest record what a person or a tool did.
        names = "; ".join(
            f"'{s.value}' ({s.label or s.value})" + (" — give the reason in 'reason', one plain sentence" if s.requires_reason else "")
            for s in settable
        )
        others = ", ".join(f"'{s.value}'" for s in schema.statuses if not s.model_may_set and not s.model_default)
        lines.append(
            f"- status: set it ONLY when the project already tells you the outcome. You may set: {names}. "
            "Otherwise leave 'status' out."
            + (f" Never set {others}: those record what a person or a tool actually did." if others else "")
        )
    return "\n".join(lines)


def _example_json(schema: StageItemSchema) -> str:
    """A literal pseudo-JSON example.

    Stating the shape in the system prompt is not enough on its own — the
    established idiom (see generate_audit_findings) restates it as a literal
    example in the user message, which is what actually holds the format.
    """
    fields = schema.fields or []
    example = {"id": "i1"}
    for field in fields:
        example[field.key] = "..."
    if not fields:
        example["text"] = "..."
    settable = [s.value for s in schema.statuses if s.model_may_set]
    if settable:
        example["status"] = f"(only if already known: {' or '.join(settable)})"
        example["reason"] = "(when the status needs one)"
    return (
        "{\n"
        '  "items": [\n'
        f"    {json.dumps(example)},\n"
        "    ...\n"
        "  ]\n"
        "}"
    )


def build_stage_prompt(
    inputs: PMInput,
    stage: StageDescriptor,
    digest: StageDigest,
    item_schema: StageItemSchema | None = None,
    existing_content: str = "",
    instruction: str = "",
) -> tuple[str, str]:
    """Build (system, user) prompts for one stage's artifact.

    Pure: no I/O, no model. `stage.entry_prompt_hint` is the authored half of
    the instruction and always reaches the system prompt; the digest always
    reaches the user prompt.
    """
    wants_items = stage.renderer in ("list", "review")
    base_instruction = _LIST_INSTRUCTION if wants_items else _PROSE_INSTRUCTION

    hint = stage.entry_prompt_hint.strip()
    schema_block = _format_item_schema(item_schema) if (wants_items and item_schema) else ""

    instruction_parts = [base_instruction]
    if hint:
        instruction_parts.append(f"THIS STAGE — {stage.label or stage.id}:\n{hint}")
    if schema_block:
        instruction_parts.append(schema_block)
        instruction_parts.append('Return JSON only, with shape: { "items": [ ... ] }.')
    system = _shared_system(inputs, [], "\n\n".join(instruction_parts))

    parts = [
        f"Original objective: {digest.objective or inputs.objective}",
        f"Audience: {digest.audience or inputs.audience}",
        f"Constraints: {inputs.constraints or '(none)'}",
        f"Output format: {inputs.output_format or '(none)'}",
        "",
        f"WHAT THE EARLIER STAGES ESTABLISHED:\n{_format_digest(digest)}",
        "",
        f"STAGE TO PRODUCE: {stage.label or stage.id}",
    ]

    # The numbers already on the record. A later stage that restates one from
    # its own reading of a summary can get it wrong, and a validation stage
    # did (1 Oct, item 32): these are to be quoted, not worked out again.
    if digest.figures:
        parts += [
            "",
            "FIGURES ALREADY ESTABLISHED by earlier stages. Wherever you refer to one of "
            "these, use this exact value: do not recompute it, round it differently or "
            "restate it from memory. If something in this stage genuinely disagrees with "
            "one, do not silently replace it — say so in words, naming both values, as a "
            "discrepancy to be resolved.",
            *[
                f"- [{f.stage}] {f.name}: {f.value}" + (f" ({f.context})" if f.context else "")
                for f in digest.figures
            ],
        ]

    # What data the project actually holds. Without this a stage planned its
    # runs as though there were none, and marked every one "not run" with a
    # dataset attached. The files can be read by code the project runs; they
    # have not been read by you.
    data = format_data_files(digest.data_files)
    parts += [
        "",
        (
            "DATA THE PROJECT HOLDS — files attached by the user, which code run for "
            "this project can read. You are shown their shape, not their contents: "
            "do not state any result from them unless it is given to you elsewhere.\n" + data
        ) if data else (
            "DATA THE PROJECT HOLDS: none. No dataset or file has been attached. Do "
            "not write as though any data had been examined."
        ),
    ]

    if digest.manuscript.strip():
        parts += [
            "",
            "THE MANUSCRIPT AS DRAFTED — the actual chapters. Work from this text, not "
            "from the summaries above, and point to the chapter and passage you mean:",
            "--- BEGIN MANUSCRIPT ---",
            digest.manuscript.strip(),
            "--- END MANUSCRIPT ---",
        ]

    if existing_content.strip():
        # Regeneration with something already on the page. Saying so keeps the
        # model from reproducing the draft it was asked to improve on.
        parts += [
            "",
            "THE CURRENT DRAFT OF THIS STAGE (produce a better one; do not repeat it verbatim):",
            existing_content.strip(),
        ]

    if instruction.strip():
        # Go mode's revise_stage carried an instruction that never reached the
        # model, so "revise" was "regenerate with the old draft as context" (B0).
        parts += [
            "",
            "REVISION INSTRUCTION — apply this to the current draft, keeping everything "
            "it does not ask you to change:",
            instruction.strip(),
        ]

    if wants_items and item_schema:
        count = (
            f"Produce between {item_schema.min_items} and {item_schema.max_items} "
            f"{item_schema.item_label}s."
        )
        parts += [
            "",
            count,
            "Return JSON in exactly this shape:",
            _example_json(item_schema),
        ]
    elif wants_items:
        parts += ["", 'Return JSON in exactly this shape:', _example_json(StageItemSchema())]
    else:
        parts += [
            "",
            "Write this stage's artifact and nothing else. Markdown is fine; "
            "headings only if the artifact genuinely has sections.",
        ]

    return system, "\n".join(parts)


_NO_SOURCE = {"", "none", "none found", "no source", "no source found", "n/a", "na", "unknown", "-", "—"}
_CLAIM_DECISIONS = {"unverifiable", "removed"}


def _claim_provenance(row: dict) -> dict:
    """The status a claim row is stored with (C3, Sean 28 Sep item 12).

    Decisions the prompt allows the model to propose (unverifiable, removed)
    are kept, "remove" included. Everything else — verified, empty, made-up —
    becomes provenance: candidate_source when a source is named, no_source
    when it is not; the reason goes with it, since it argued for a status the
    row no longer has.
    """
    status = row.get("status")
    normalised = status.strip().lower() if isinstance(status, str) else ""
    if normalised == "remove":
        normalised = "removed"
    if normalised in _CLAIM_DECISIONS:
        return {"status": normalised}
    source = row.get("source")
    named = isinstance(source, str) and source.strip().lower() not in _NO_SOURCE
    out = {"status": "candidate_source" if named else "no_source"}
    row.pop("reason", None)
    return out


def _model_status(row: dict, schema: StageItemSchema) -> dict:
    """The status a generated row is stored with, when the client said who may set what.

    Kept only if it is one the model may set and it carries its reason where
    one is required; then marked as the model's, so the screen can say
    "set by PromptMaster — review or change". Anything else is dropped: a
    model that writes "completed" on a run nobody ran is guessing, and the
    row goes back to undecided. A row with no kept status starts in the
    schema's default for generated rows, if it has one.
    """
    by_value = {s.value: s for s in schema.statuses}
    status = row.get("status")
    chosen = by_value.get(status.strip().lower()) if isinstance(status, str) else None
    reason = row.get("reason")
    reason = reason.strip() if isinstance(reason, str) else ""
    row.pop("status", None)
    row.pop("reason", None)
    row.pop("status_source", None)
    if chosen and chosen.model_may_set and (reason or not chosen.requires_reason):
        out = {"status": chosen.value, "status_source": "model"}
        if reason:
            out["reason"] = reason
        return out
    default = next((s for s in schema.statuses if s.model_default), None)
    return {"status": default.value, "status_source": "model"} if default else {}


def _parse_items(raw_result: dict, schema: StageItemSchema | None) -> list[StageItem]:
    """Defensive parse, matching generate_audit_findings.

    A malformed row is skipped, not fatal: half a claim table is useful and
    editable, an exception is neither. Missing ids are backfilled so the client
    has a stable React key and a target for per-row edits.
    """
    raw_list = raw_result.get("items")
    if not isinstance(raw_list, list):
        return []

    allowed = {f.key for f in (schema.fields if schema else [])}
    items: list[StageItem] = []
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        if not row.get("id"):
            row["id"] = f"i{uuid.uuid4().hex[:6]}"
        # Coerce scalars to strings: a model that answers `true` for a text
        # field should not cost the user the whole row.
        for key, value in list(row.items()):
            if value is None:
                row[key] = ""
            elif not isinstance(value, (str, list, dict)):
                row[key] = str(value)
        if allowed:
            # Keep declared fields plus id; a hallucinated extra column renders
            # as a stray input the user cannot explain.
            row = {k: v for k, v in row.items() if k in allowed or k in ("id", "status", "reason")}
        # A status the model proposes is a suggestion, and two of them are not
        # even the model's to make. The stored value for "remove" is "removed"
        # (a row marked "remove" matched no option and showed as "Not looked
        # at"), and "verified" means the *author* checked the source — nothing
        # here retrieved anything, so a model that says verified is guessing
        # (Sean, 28 Sep, item 12: "If I personally click Verified, what am I
        # representing?"). Verification is left to the user.
        # C3: a claim starts in a provenance state PromptMaster sets —
        # candidate_source (it named where to check) or no_source — and the
        # author decides from there. A model that says "verified" has named a
        # candidate at most; "verified_by_promptmaster" is a tool's to set.
        if "claim" in allowed:
            row.update(_claim_provenance(row))
        elif schema and schema.statuses:
            row.update(_model_status(row, schema))
        try:
            items.append(StageItem(**row))
        except Exception as parse_err:
            logger.warning(f"Skipping malformed stage item: {parse_err}")
    return items


async def generate_stage_artifact(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    stage: StageDescriptor,
    digest: StageDigest,
    item_schema: StageItemSchema | None = None,
    existing_content: str = "",
    instruction: str = "",
) -> GenerateStageArtifactResponse:
    """Generate one stage's artifact. One LLM call.

    Prose stages come back as Markdown in `content`; list and review stages come
    back as `items`. A list stage that fails to parse returns an empty list
    rather than raising — the user gets an editable empty stage and a
    Regenerate button, which beats an error page.
    """
    system, user = build_stage_prompt(
        inputs=inputs,
        stage=stage,
        digest=digest,
        item_schema=item_schema,
        existing_content=existing_content,
        instruction=instruction,
    )

    if stage.renderer in ("list", "review"):
        try:
            result, _usage = await client.generate_json(
                prompt=user,
                system=system,
                temperature=0.4,
                max_tokens=2048,
                model=model,
            )
        except Exception as e:
            logger.warning(f"Stage artifact JSON call failed for {stage.id}: {e}")
            return GenerateStageArtifactResponse(items=[], finish_reason="error")
        return GenerateStageArtifactResponse(
            items=_parse_items(result, item_schema),
            finish_reason="stop",
        )

    content, _usage, finish_reason = await client.generate_with_meta(
        prompt=user,
        system=system,
        temperature=0.7,
        max_tokens=4096,
        model=model,
    )
    return GenerateStageArtifactResponse(content=content, finish_reason=finish_reason)
