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
    "user, and do not add meta commentary about the process. Return Markdown "
    "prose, no code fences around the whole answer."
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
        lines.append(f"- {field.key}: {label}.{hint}".rstrip())
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

    if existing_content.strip():
        # Regeneration with something already on the page. Saying so keeps the
        # model from reproducing the draft it was asked to improve on.
        parts += [
            "",
            "THE CURRENT DRAFT OF THIS STAGE (produce a better one; do not repeat it verbatim):",
            existing_content.strip(),
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
