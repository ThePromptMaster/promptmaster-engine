"""Assessing pasted items against a rubric, on the user's scale (25 Oct).

The client screens executive candidates by pasting LinkedIn profiles into a
chat and asking for a colour-coded verdict on whether to screen each one — a
few at a time, again and again, against criteria set once. Nothing in a stage
did that: a table stage drafts its rows once, from the brief, and a new round
replaces them.

So an Assess stage takes what the user pastes, finds each separate item in it,
and judges every one against the criteria the earlier stages established, on a
scale the user chose (traffic light, 1–5, pass/fail, A–F, or their own words).
The rows come back for the browser to append to what is already there; nothing
here is about candidates, so the same stage screens suppliers, proposals or
applications.

One model call per batch. The verdict must be one of the scale's values: one
that is not is cleared and said, never guessed into the nearest level.
"""

from __future__ import annotations

import logging
import uuid

from pydantic import BaseModel, Field

from .conversation import _shared_system
from .llm_client import OpenRouterClient, OpenRouterDeadlineError, OpenRouterError
from .project_context import context_block
from .saved_documents import format_prior_documents
from .schemas import PMInput, StageDigest

logger = logging.getLogger(__name__)

#: What one batch may carry. Ten long profiles run to about 30,000 characters.
MAX_ASSESS_CHARS = 40_000
#: Items judged in one call; the rest of a longer paste is said, not dropped silently.
MAX_ASSESS_ITEMS = 12
MAX_SCALE_LEVELS = 7


class ScaleLevel(BaseModel):
    value: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=60)
    #: What earns this level, in the user's words where they gave them.
    meaning: str = Field(default="", max_length=300)


class AssessScale(BaseModel):
    """Best level first."""
    levels: list[ScaleLevel] = Field(min_length=2, max_length=MAX_SCALE_LEVELS)


class AssessedItem(BaseModel):
    id: str
    subject: str = ""
    verdict: str = ""
    rationale: str = ""
    evidence: str = ""
    gaps: str = ""


class AssessBatchResult(BaseModel):
    items: list[AssessedItem] = Field(default_factory=list)
    #: Rows whose verdict was not on the scale, cleared for the user to set.
    ungraded: int = 0
    #: Items found in the paste beyond what one batch judges.
    not_assessed: int = 0
    #: The first line of the first item not judged, exactly as pasted, so the page
    #: carries on from there (15 Nov, Sean: "13 more were in the paste; assess them
    #: in another batch", and nowhere to do it). Empty when it is not in the paste.
    next_from: str = ""
    #: Items in the paste that were already in the table, left out.
    already_in_table: int = 0
    finish_reason: str = "stop"


_ASSESS_INSTRUCTION = (
    "ASSESS MODE: The user has pasted one or more items — profiles, applications, "
    "proposals, documents — to be judged against criteria they set earlier. Find "
    "each separate item in the pasted text (one person, one supplier, one "
    "proposal), and judge every one against THE CRITERIA, on THE SCALE, and on "
    "nothing else.\n"
    "Rules:\n"
    "- Judge only on what the pasted text says about that item. Never invent "
    "experience, dates, employers, figures or qualifications it does not state, "
    "and never fill a gap with what is typical. Where the text does not say "
    "something a criterion needs, say so in `gaps` and judge on what is there.\n"
    "- `verdict` is exactly one of the scale's values, as written. Pick the level "
    "whose meaning the item fits; where it is between two, pick the lower and say why.\n"
    "- `subject` names the item as the text does (a name and current title, a "
    "company, a proposal title), at most 120 characters.\n"
    "- `rationale` is two to four short lines, each starting \"- \", naming the "
    "criteria the item meets or misses.\n"
    "- `evidence` quotes the pasted text's own words that the verdict rests on, "
    "in quotation marks, at most three short quotes.\n"
    "- `gaps` lists what the criteria ask for that the text does not say, or is "
    "empty when nothing is missing.\n"
    "- Do not judge on age, gender, ethnicity, religion, disability, marital or "
    "family status, or any other protected characteristic, nor on proxies for "
    "them (photos, graduation years as a stand-in for age, names). If a criterion "
    "asks for one, ignore that criterion and say so in `gaps`.\n"
    f"- At most {MAX_ASSESS_ITEMS} items, in the order they appear. If the text holds "
    "more, judge the first ones, give the count of the rest as `not_assessed`, and copy "
    "the first line of the first item you did not judge into `next_from`, character for "
    "character as it is in the pasted text (it is where the next batch starts).\n"
    "- An item named under ALREADY IN THE TABLE is not judged again: leave it out of "
    "`items` and count it in `already_in_table`.\n"
    "Return JSON only, with shape: "
    '{ "items": [ { "subject": "", "verdict": "", "rationale": "", "evidence": "", "gaps": "" } ], '
    '"not_assessed": 0, "next_from": "", "already_in_table": 0 }'
)


def _scale_block(scale: AssessScale) -> str:
    lines = [
        f'- "{lvl.value}" — {lvl.label}' + (f": {lvl.meaning}" if lvl.meaning.strip() else "")
        for lvl in scale.levels
    ]
    return "THE SCALE, best first (verdict must be one of these values):\n" + "\n".join(lines)


def build_assess_prompt(
    inputs: PMInput,
    digest: StageDigest,
    scale: AssessScale,
    text: str,
    stage_hint: str = "",
    already: list[str] | None = None,
) -> tuple[str, str]:
    """(system, user) for one batch. Pure, so the prompt can be asserted without a model."""
    parts = [_ASSESS_INSTRUCTION, _scale_block(scale)]
    if stage_hint.strip():
        parts.append(f"THIS STAGE:\n{stage_hint.strip()}")
    system = _shared_system(inputs, [], "\n\n".join(parts))

    context = context_block(inputs)
    user = [
        f"Objective: {digest.objective or inputs.objective}",
        *([f"Audience: {inputs.audience}"] if inputs.audience.strip() else []),
        *([context, ""] if context else [""]),
        # The criteria are what the earlier stages established — a Criteria
        # stage in the Assess workflow, whatever a designed workflow put first.
        f"THE CRITERIA (what the earlier stages established):\n{format_prior_documents(digest)}",
        "",
        _scale_block(scale),
        "",
    ]
    if already:
        # 15 Nov: a batch carried on from where the last one stopped, or pasted
        # again, would otherwise add the same people twice.
        user += [
            "ALREADY IN THE TABLE (not judged again):",
            *(f"- {s}" for s in already[:200]),
            "",
        ]
    user += ["--- BEGIN PASTED ITEMS ---", text.strip(), "--- END PASTED ITEMS ---"]
    return system, "\n".join(user)


def _match_level(raw: str, scale: AssessScale) -> str:
    """The scale value a model's verdict names, or "" when it names none."""
    said = " ".join(str(raw or "").split()).strip().strip('"').casefold()
    if not said:
        return ""
    for lvl in scale.levels:
        if said in (lvl.value.casefold(), lvl.label.casefold()):
            return lvl.value
    return ""


def _text(value: object, limit: int) -> str:
    if isinstance(value, list):
        value = "\n".join(f"- {v}" for v in value if str(v).strip())
    return str(value or "").strip()[:limit]


def parse_assessment(raw: object, scale: AssessScale, text: str = "") -> AssessBatchResult:
    rows = raw.get("items") if isinstance(raw, dict) else None
    items: list[AssessedItem] = []
    ungraded = 0
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        subject = _text(row.get("subject"), 120)
        rationale = _text(row.get("rationale"), 800)
        if not (subject or rationale):
            continue
        verdict = _match_level(str(row.get("verdict") or ""), scale)
        if not verdict:
            ungraded += 1
        items.append(AssessedItem(
            id=f"a_{uuid.uuid4().hex[:10]}",
            subject=subject,
            verdict=verdict,
            rationale=rationale,
            evidence=_text(row.get("evidence"), 600),
            gaps=_text(row.get("gaps"), 400),
        ))
    extra = raw.get("not_assessed") if isinstance(raw, dict) else 0
    not_assessed = extra if isinstance(extra, int) and extra > 0 else 0
    if len(items) > MAX_ASSESS_ITEMS:
        not_assessed += len(items) - MAX_ASSESS_ITEMS
        items = items[:MAX_ASSESS_ITEMS]
    # Where the next batch starts, kept only when it is really in the paste.
    start = " ".join(str(raw.get("next_from") or "").split()).strip() if isinstance(raw, dict) else ""
    flat = " ".join(text.split())
    next_from = start[:300] if not_assessed and start and start in flat else ""
    seen = raw.get("already_in_table") if isinstance(raw, dict) else 0
    already_in_table = seen if isinstance(seen, int) and seen > 0 else 0
    # The shape puts `not_assessed` and `next_from` after the items. A reply with
    # items and neither was cut off and closed by the repair: how many were left is
    # not known, so the page keeps the rest of the paste instead of dropping it
    # (26 Nov, L-284).
    tail_missing = isinstance(raw, dict) and bool(items) and "not_assessed" not in raw and "next_from" not in raw
    return AssessBatchResult(
        items=items,
        ungraded=ungraded,
        not_assessed=not_assessed,
        next_from=next_from,
        already_in_table=already_in_table,
        finish_reason="length" if tail_missing else "stop",
    )


async def assess_batch(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    digest: StageDigest,
    scale: AssessScale,
    text: str,
    stage_hint: str = "",
    already: list[str] | None = None,
) -> AssessBatchResult:
    """Judge one pasted batch. One LLM call."""
    system, user = build_assess_prompt(inputs, digest, scale, text, stage_hint, already)
    try:
        raw, _usage = await client.generate_json(
            prompt=user, system=system, temperature=0.2, max_tokens=8192, model=model,
        )
    except Exception as e:
        # A refused or timed-out call is an error the router classifies; only a
        # reply that would not parse is an empty batch.
        if isinstance(e, OpenRouterDeadlineError) or (
            isinstance(e, OpenRouterError) and (e.status_code is not None or e.provider_code)
        ):
            raise
        logger.warning("assess batch JSON failed: %s", e)
        return AssessBatchResult(finish_reason="error")
    return parse_assessment(raw, scale, text)
