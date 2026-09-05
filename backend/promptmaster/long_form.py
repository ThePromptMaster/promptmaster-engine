"""Long-form document orchestration: detect + outline + section helpers.

Pure functions and helpers used by routers/long_form.py.
Reuses promptmaster.continuity for snapshot regeneration.
"""

from __future__ import annotations

import logging
import uuid

from .continuity import generate_continuity_snapshot
from .conversation import _shared_system
from .llm_client import OpenRouterClient, OpenRouterDeadlineError
from .schemas import (
    ContinuitySnapshot,
    DetectLongFormResponse,
    GenerateSectionProseResponse,
    GenerateSectionResponse,
    GlossaryTerm,
    OutlineSection,
    PMInput,
    SectionRecord,
)

logger = logging.getLogger(__name__)


_DETECT_SYSTEM = (
    "You are a classifier. Given a user's writing request, decide if it is a "
    "long-form document (multi-section deliverable, paper, report, book chapter, "
    "BRD, white paper, proposal of more than a couple pages). Return JSON only."
)


def build_detect_prompt(inputs: PMInput) -> tuple[str, str]:
    """Build (system, user) prompts for the long-form classifier."""
    user = (
        f"Objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        "Return JSON with fields:\n"
        "- is_long_form: true if this needs multiple sections / pages; false for short asks\n"
        "- suggested_section_count: integer estimate of section count if long-form, else 0\n"
        "- reason: one short sentence explaining the call"
    )
    return _DETECT_SYSTEM, user


async def detect_long_form(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
) -> DetectLongFormResponse:
    """Classify whether the request is long-form. Falls back to negative on any error."""
    system, user = build_detect_prompt(inputs)
    try:
        result, _usage = await client.generate_json(
            prompt=user,
            system=system,
            temperature=0.1,
            max_tokens=200,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Long-form detect failed, defaulting to negative: {e}")
        return DetectLongFormResponse(is_long_form=False, suggested_section_count=0, reason="")

    return DetectLongFormResponse(
        is_long_form=bool(result.get("is_long_form", False)),
        suggested_section_count=int(result.get("suggested_section_count", 0) or 0),
        reason=str(result.get("reason", "")),
    )


_OUTLINE_SYSTEM = (
    "You design clear, well-scoped outlines for long-form documents. "
    "Each section title is concrete and non-overlapping. Each abstract is a "
    "single sentence describing what that section covers. Return JSON only."
)


def build_outline_prompt(inputs: PMInput, suggested_section_count: int) -> tuple[str, str]:
    """Build (system, user) prompts for outline generation."""
    user = (
        f"Objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n"
        f"Target section count: {suggested_section_count} (use this as a guide; "
        "adjust if the objective genuinely needs more or fewer).\n\n"
        "Return JSON with one field:\n"
        '- outline: array of {"title": string, "abstract": string}\n\n'
        "Each abstract must be ONE short sentence (≤20 words) describing what that "
        "section will cover. Titles must be concrete and non-overlapping."
    )
    return _OUTLINE_SYSTEM, user


async def generate_outline(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    suggested_section_count: int,
) -> list[OutlineSection]:
    """Generate an outline. Returns OutlineSection[] with auto-assigned ids and default fields."""
    system, user = build_outline_prompt(inputs, suggested_section_count)
    result, _usage = await client.generate_json(
        prompt=user,
        system=system,
        temperature=0.4,
        max_tokens=2048,
        model=model,
    )
    raw_outline = result.get("outline")
    if not isinstance(raw_outline, list):
        raise ValueError(f"generate_outline expected list, got {type(raw_outline).__name__}")

    sections: list[OutlineSection] = []
    for raw in raw_outline:
        if not isinstance(raw, dict):
            continue
        sections.append(OutlineSection(
            id=str(uuid.uuid4()),
            title=str(raw.get("title", "Untitled")),
            abstract=str(raw.get("abstract", "")),
        ))
    return sections


def _format_outline_for_prompt(outline: list[OutlineSection], current_index: int) -> str:
    """Render outline as a numbered list with a marker on the section being written."""
    lines = []
    for i, section in enumerate(outline):
        marker = " ← WRITING NOW" if i == current_index else ""
        lines.append(f"{i + 1}. {section.title}{marker}\n   {section.abstract}")
    return "\n".join(lines)


def _format_snapshot_for_prompt(snapshot: ContinuitySnapshot | None) -> str:
    if snapshot is None:
        return "(no prior sections)"
    parts = []
    if snapshot.completed_topics:
        parts.append(f"Completed topics: {', '.join(snapshot.completed_topics)}")
    # current_topic was generated, stored and then silently dropped here, which
    # meant the one field describing where the last section trailed off never
    # reached the model that had to continue from it.
    if snapshot.current_topic:
        parts.append(f"Trailing off mid-topic: {snapshot.current_topic}")
    if snapshot.key_definitions:
        parts.append(f"Key definitions: {'; '.join(snapshot.key_definitions)}")
    if snapshot.next_topic_hint:
        parts.append(f"Next topic hint: {snapshot.next_topic_hint}")
    return "\n".join(parts) if parts else "(no prior context recorded)"


# ---------------------------------------------------------------------------
# Bounded context (FR-06)
# ---------------------------------------------------------------------------
#
# These caps are the whole reason a book can exceed ~100 pages. Every part of
# the section prompt that would otherwise grow with the prose already written is
# clipped to a constant here, so the prompt for section 40 is the same size as
# the prompt for section 4. The outline is the only O(n) term and it is fixed
# for the life of the project, which is what makes the growth flat rather than
# merely slow.

#: Full summaries for the sections immediately behind this one. Earlier sections
#: are omitted entirely rather than truncated — their titles and abstracts are
#: already in the FULL OUTLINE block, so repeating them buys nothing.
_MAX_RECENT_SUMMARIES = 3
#: The glossary is the one thing that legitimately accumulates, so it is capped
#: and kept newest-first: a term defined in section 30 matters more to section 31
#: than one defined in section 2 and never used since.
_MAX_GLOSSARY_TERMS = 24
_MAX_DECISIONS = 10
_MAX_TODOS = 10
#: The previous section is included for tonal anchoring only, so its tail is as
#: good as the whole thing and does not scale with how long sections get.
_PREV_SECTION_TAIL_CHARS = 1500
#: Grounding for the LEGACY rolling snapshot. Same reasoning, applied to the
#: path that predates records.
_SNAPSHOT_GROUNDING_CHARS = 12000


def _tail(text: str, limit: int) -> str:
    """Keep the last `limit` characters, marking the cut so the model knows."""
    if len(text) <= limit:
        return text
    return "…(earlier text omitted)…\n" + text[-limit:]


def _dedupe_glossary(records: list[SectionRecord]) -> list[GlossaryTerm]:
    """Newest definition of each term wins, newest terms first, then capped."""
    seen: dict[str, GlossaryTerm] = {}
    for record in reversed(records):
        for term in record.glossary_terms:
            key = term.term.strip().lower()
            if key and key not in seen:
                seen[key] = term
    return list(seen.values())[:_MAX_GLOSSARY_TERMS]


def _format_records_for_prompt(records: list[SectionRecord]) -> str:
    """Render persisted continuity records as a fixed-size context block."""
    if not records:
        return "(no prior sections)"

    ordered = sorted(records, key=lambda r: r.section_index)
    parts: list[str] = []

    recent = ordered[-_MAX_RECENT_SUMMARIES:]
    if recent:
        lines = [f"- {r.title or f'Section {r.section_index + 1}'}: {r.summary}" for r in recent if r.summary]
        if lines:
            parts.append("Recently written:\n" + "\n".join(lines))

    glossary = _dedupe_glossary(ordered)
    if glossary:
        terms = "; ".join(f"{t.term} — {t.definition}" if t.definition else t.term for t in glossary)
        parts.append(f"Established terms (use these exactly, do not redefine): {terms}")

    decisions: list[str] = []
    todos: list[str] = []
    for record in reversed(ordered):
        for d in record.decisions:
            if len(decisions) < _MAX_DECISIONS:
                decisions.append(d)
        for t in record.todos:
            if len(todos) < _MAX_TODOS:
                todos.append(t)

    if decisions:
        parts.append("Decisions already made: " + "; ".join(decisions))
    if todos:
        parts.append("Promises still owed to the reader: " + "; ".join(todos))

    return "\n".join(parts) if parts else "(no prior context recorded)"


_SECTION_INSTRUCTION = (
    "LONG-FORM EXECUTION MODE: You are writing ONE section of a multi-section "
    "document. Write only the section indicated below. Do NOT outline, do NOT "
    "summarize what other sections will cover, do NOT include meta commentary. "
    "Write the actual prose for this section in the style and tone of the mode."
)


def build_section_prompt(
    inputs: PMInput,
    outline: list[OutlineSection],
    section_index: int,
    prior_snapshot: ContinuitySnapshot | None,
    prev_section_content: str,
    records: list[SectionRecord] | None = None,
) -> tuple[str, str]:
    """Build (system, user) prompts for one section's generation.

    `records` is the FR-06 path and takes precedence when supplied: persisted
    per-section records compose into a fixed-size context block. `prior_snapshot`
    remains for the older session flow, which has no record store behind it.

    The size of what this returns does not grow with the number of sections
    already written — see the caps above. That property is asserted directly by
    the bounded-context test, because it is the difference between a document
    that can be finished and one that stalls at around a hundred pages.
    """
    target = outline[section_index]
    outline_text = _format_outline_for_prompt(outline, section_index)
    if records:
        context_text = _format_records_for_prompt(records)
    else:
        context_text = _format_snapshot_for_prompt(prior_snapshot)

    system = _shared_system(inputs, [], _SECTION_INSTRUCTION)
    user = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"FULL OUTLINE:\n{outline_text}\n\n"
        f"PRIOR CONTEXT:\n{context_text}\n\n"
        f"IMMEDIATELY PREVIOUS SECTION (for tonal/stylistic anchoring; do NOT repeat):\n"
        f"{_tail(prev_section_content, _PREV_SECTION_TAIL_CHARS) or '(none — this is the first section)'}\n\n"
        f"WRITE SECTION {section_index + 1}: {target.title}\n"
        f"This section covers: {target.abstract}\n\n"
        "Write only the prose for this section. Do not include the section title or "
        "number; just the body content. Stay focused on what this section's abstract says."
    )
    return system, user


async def generate_section_prose(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    outline: list[OutlineSection],
    section_index: int,
    prior_snapshot: ContinuitySnapshot | None = None,
    prev_section_content: str = "",
    records: list[SectionRecord] | None = None,
    deadline: float | None = None,
) -> GenerateSectionProseResponse:
    """Write one section. One LLM call, and nothing else.

    This is the expensive half, and it is separate from record extraction so
    that the drain can commit the prose the moment it exists. Anything that
    happens after this call returns is, by construction, cheap to redo.
    """
    system, user = build_section_prompt(
        inputs=inputs,
        outline=outline,
        section_index=section_index,
        prior_snapshot=prior_snapshot,
        prev_section_content=prev_section_content,
        records=records,
    )

    content, _usage, finish_reason = await client.generate_with_meta(
        prompt=user,
        system=system,
        temperature=0.7,
        max_tokens=4096,
        model=model,
        deadline=deadline,
    )
    return GenerateSectionProseResponse(content=content, finish_reason=finish_reason)


_RECORD_SYSTEM = (
    "You extract a small structured continuity record from ONE freshly written "
    "section of a longer document, so that later sections stay consistent with it "
    "without having to re-read the whole document. Be terse. Return JSON only."
)


def build_section_record_prompt(
    section_title: str,
    section_content: str,
    existing_terms: list[str],
) -> tuple[str, str]:
    """Build (system, user) prompts for record extraction.

    Note what is NOT here: the rest of the document. The input is one section
    plus the *names* of terms already in the glossary. That is what keeps the
    extraction call constant-cost, and it is the inversion the old
    whole-document snapshot call could not do.
    """
    known = ", ".join(existing_terms[:_MAX_GLOSSARY_TERMS]) if existing_terms else "(none yet)"
    user = (
        f"Section title: {section_title or '(untitled)'}\n"
        f"Terms already defined earlier in the document: {known}\n\n"
        "Read the section below and return JSON with these fields:\n"
        '- summary: 2-3 sentences describing what this section actually said\n'
        '- glossary_terms: array of {"term": string, "definition": string} for terms this '
        "section DEFINES or uses in a specific technical sense. Do NOT repeat terms already "
        "listed above unless this section changed their meaning. Empty array if none.\n"
        "- decisions: array of short strings naming choices this section commits the "
        "document to (scope, stance, structure). Empty array if none.\n"
        "- todos: array of short strings for anything this section explicitly promises to "
        "cover later. Empty array if none.\n\n"
        "SECTION:\n"
        f"{section_content}\n\n"
        "Return JSON only."
    )
    return _RECORD_SYSTEM, user


async def extract_section_record(
    client: OpenRouterClient,
    model: str | None,
    section_id: str,
    section_index: int,
    section_title: str,
    section_content: str,
    existing_terms: list[str],
    deadline: float | None = None,
) -> SectionRecord:
    """Extract one section's continuity record. One LLM call over one section.

    Defensive parsing throughout, matching the house idiom: a malformed row is
    skipped rather than fatal. A record is an optimisation for later sections —
    losing one degrades continuity, but throwing away prose that is already
    written and paid for would be far worse.
    """
    system, user = build_section_record_prompt(section_title, section_content, existing_terms)
    try:
        result, _usage = await client.generate_json(
            prompt=user,
            system=system,
            temperature=0.2,
            max_tokens=768,
            model=model,
            deadline=deadline,
        )
    except OpenRouterDeadlineError:
        # The drain distinguishes this from a bad response: it means "re-queue
        # me", not "this section is broken".
        raise
    except Exception as e:
        logger.warning(f"Section record extraction failed, returning a bare record: {e}")
        return SectionRecord(section_id=section_id, section_index=section_index, title=section_title)

    terms: list[GlossaryTerm] = []
    raw_terms = result.get("glossary_terms")
    if isinstance(raw_terms, list):
        for raw in raw_terms:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("term", "")).strip()
            if not name:
                continue
            terms.append(GlossaryTerm(
                term=name,
                definition=str(raw.get("definition", "") or ""),
                first_seen_section_id=section_id,
            ))

    def _strings(key: str) -> list[str]:
        raw = result.get(key)
        if not isinstance(raw, list):
            return []
        return [str(x).strip() for x in raw if isinstance(x, (str, int, float)) and str(x).strip()]

    return SectionRecord(
        section_id=section_id,
        section_index=section_index,
        title=section_title,
        summary=str(result.get("summary", "") or ""),
        glossary_terms=terms,
        decisions=_strings("decisions"),
        todos=_strings("todos"),
    )


async def generate_section(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    outline: list[OutlineSection],
    section_index: int,
    prior_snapshot: ContinuitySnapshot | None,
    prev_section_content: str,
) -> GenerateSectionResponse:
    """Generate one section's content + regenerate the rolling continuity snapshot.

    The legacy single-call path, kept for /api/generate-section and the session
    flow that has no record store behind it. Job-driven drafting does NOT use
    this: it calls generate_section_prose and extract_section_record as two
    separately committed steps, so that a worker dying between them cannot
    discard prose the user has already paid for.
    """
    prose = await generate_section_prose(
        client=client,
        model=model,
        inputs=inputs,
        outline=outline,
        section_index=section_index,
        prior_snapshot=prior_snapshot,
        prev_section_content=prev_section_content,
    )

    # Ground the snapshot in the recent document rather than all of it. This used
    # to concatenate every completed section, which made the snapshot call's
    # input grow linearly with the document — the same ceiling SectionRecord
    # exists to remove, reached here one call later.
    completed_so_far = "\n\n".join(
        s.content for s in outline[:section_index] if s.status == "complete" and s.content
    )
    merged = (completed_so_far + "\n\n" + prose.content).strip() if completed_so_far else prose.content
    merged_for_snapshot = _tail(merged, _SNAPSHOT_GROUNDING_CHARS)

    new_snapshot = await generate_continuity_snapshot(
        client=client,
        model=model,
        inputs=inputs,
        previous_output=merged_for_snapshot,
    )

    return GenerateSectionResponse(
        content=prose.content,
        finish_reason=prose.finish_reason,
        new_snapshot=new_snapshot,
    )
