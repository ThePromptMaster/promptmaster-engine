"""Snapshot generation and continuation prompt builders.

Used by the /api/continue-document endpoint. Lazy: snapshot generation
runs only when the user clicks Continue Document, never eagerly.
"""

from __future__ import annotations

import logging

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import ContinuitySnapshot, Iteration, PMInput
from .project_context import context_line

logger = logging.getLogger(__name__)


_SNAPSHOT_SYSTEM = (
    "You compress in-progress work into a small structured snapshot so a "
    "continuation prompt can be built. Be concise. Output JSON only."
)


def build_snapshot_prompt(
    inputs: PMInput,
    previous_output: str,
) -> tuple[str, str]:
    """Build (system, user) prompts for the snapshot LLM call."""
    user = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"{context_line(inputs)}"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        "Identify each of the following from the partial output below:\n"
        "- completed_topics: list of short phrases naming sections/topics already covered\n"
        "- current_topic: the section/topic where the output trails off, or null if it stopped cleanly between sections\n"
        "- key_definitions: list of terms, constraints, or decisions established that the continuation must respect\n"
        "- next_topic_hint: short phrase describing what to write next, or null\n\n"
        "Partial output:\n"
        f"{previous_output}\n\n"
        "Return JSON only."
    )
    return _SNAPSHOT_SYSTEM, user


async def generate_continuity_snapshot(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    previous_output: str,
) -> ContinuitySnapshot:
    """Run a small generate_json call. Returns parsed snapshot.

    Defensive parsing: missing fields default to empty list / None so a
    malformed response can't crash the continuation flow.
    """
    system, user = build_snapshot_prompt(inputs, previous_output)
    try:
        result, _usage = await client.generate_json(
            prompt=user,
            system=system,
            temperature=0.2,
            max_tokens=512,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Snapshot generation failed, returning empty snapshot: {e}")
        return ContinuitySnapshot()

    return ContinuitySnapshot(
        completed_topics=result.get("completed_topics") or [],
        current_topic=result.get("current_topic"),
        key_definitions=result.get("key_definitions") or [],
        next_topic_hint=result.get("next_topic_hint"),
    )


_CONTINUATION_INSTRUCTION = (
    "CONTINUATION MODE: The previous output was incomplete and stopped before the work "
    "was finished. You are continuing the same task from where it left off.\n\n"
    "STATE SNAPSHOT (what's been done so far):\n"
    "- Completed topics: {completed_topics}\n"
    "- Current topic (where it trails off): {current_topic}\n"
    "- Key definitions / constraints to respect: {key_definitions}\n"
    "- Suggested next topic: {next_topic_hint}\n\n"
    "CRITICAL RULES:\n"
    "- Do NOT repeat any content already in the previous output.\n"
    "- Continue from where the previous output trails off — same tone, same structure.\n"
    "- If the structure has numbered sections, continue the numbering.\n"
    "- Stop when you've covered the remaining sections/topics naturally."
)


def build_continuation_prompt(
    inputs: PMInput,
    incomplete_iteration: Iteration,
    snapshot: ContinuitySnapshot,
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompts for the continuation generation call."""
    instruction = _CONTINUATION_INSTRUCTION.format(
        completed_topics=", ".join(snapshot.completed_topics) if snapshot.completed_topics else "(none recorded)",
        current_topic=snapshot.current_topic or "(none)",
        key_definitions="; ".join(snapshot.key_definitions) if snapshot.key_definitions else "(none recorded)",
        next_topic_hint=snapshot.next_topic_hint or "(continue naturally)",
    )
    system = _shared_system(inputs, iterations, instruction)
    user = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"{context_line(inputs)}"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        "PREVIOUS OUTPUT (do not repeat any of this):\n"
        f"{incomplete_iteration.output}\n\n"
        "Continue from where the previous output trails off. Output only the continuation."
    )
    return system, user
