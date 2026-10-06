"""What a change to the brief reopens (Sean, 5 Oct).

"An authoritative input changes from 'funding secured' to 'funding pending'.
PromptMaster should identify recommendations and plans that relied on secured
funding, mark them for appropriate review … Unaffected work should remain
valid." And: "The user corrects punctuation or formatting without changing
meaning. PromptMaster should update the artifact without reopening unrelated
analysis." And: "The user changes the priority from maximizing short-term
margin to preserving headcount. Existing calculations may remain valid.
Recommendations should be reconsidered against the new priority."

A pure wording change is caught in the browser without a call
(lib/workflow/brief-change.ts). Anything else is one call here: given the old
and new text and what each finished stage concluded (its stored summary and the
figures it recorded), which stages relied on what changed, and why. Stage ids
the model invents are dropped in code. Stage-level, not claim-level: the
finest grain the project records today (L-39).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

ChangeKind = Literal["fact", "intent", "wording"]


class StageConclusion(BaseModel):
    stage_id: str = Field(max_length=80)
    label: str = Field(max_length=200)
    summary: str = Field(default="", max_length=2_000)
    figures: list[str] = Field(default_factory=list, max_length=60)
    #: True when the stage holds numbers worked out from data (an analysis), not a recommendation.
    computed: bool = False


class Affected(BaseModel):
    stage_id: str
    reason: str = Field(default="", max_length=300)


class ChangeImpact(BaseModel):
    kind: ChangeKind = "fact"
    affected: list[Affected] = Field(default_factory=list)
    calculations_hold: bool = True


_IMPACT_INSTRUCTION = (
    "You judge what a change to a project's brief invalidates. You are given the field "
    "that changed, its old and new text, and what each finished stage of the project "
    "concluded. Decide:\n"
    "- kind: 'wording' if the meaning is the same; 'fact' if a fact the work relies on "
    "changed; 'intent' if the objective, priority or what the user wants changed.\n"
    "- affected: ONLY the stages whose conclusions relied on what changed, each with one "
    "plain sentence naming what it relied on. A stage that did not use it is not affected. "
    "For a change of intent, numbers worked out from data usually still hold — list such a "
    "stage only if the change alters what it had to compute; recommendations, plans and "
    "conclusions judged against the old intent are affected.\n"
    "- calculations_hold: false only if computed results themselves are no longer right.\n"
    "Return JSON only."
)


def build_impact_prompt(field: str, before: str, after: str, stages: list[StageConclusion]) -> tuple[str, str]:
    lines = []
    for s in stages:
        figs = f" Figures: {'; '.join(s.figures[:20])}." if s.figures else ""
        tag = " (computed from data)" if s.computed else ""
        lines.append(f"- id={s.stage_id} — {s.label}{tag}: {s.summary or '(no summary)'}{figs}")
    user = (
        f"FIELD: {field}\n"
        f"--- BEFORE ---\n{before.strip() or '(empty)'}\n--- AFTER ---\n{after.strip() or '(empty)'}\n\n"
        f"FINISHED STAGES:\n" + "\n".join(lines) + "\n\n"
        'Return JSON: {"kind": "fact|intent|wording", "affected": [{"stage_id": "...", "reason": "..."}], '
        '"calculations_hold": true}'
    )
    return _IMPACT_INSTRUCTION, user


def parse_impact(result: object, stage_ids: set[str]) -> ChangeImpact:
    if not isinstance(result, dict):
        return ChangeImpact()
    kind = result.get("kind") if result.get("kind") in ("fact", "intent", "wording") else "fact"
    affected: list[Affected] = []
    seen: set[str] = set()
    for a in result.get("affected") or []:
        sid = str(a.get("stage_id") or "") if isinstance(a, dict) else ""
        if sid in stage_ids and sid not in seen:
            seen.add(sid)
            affected.append(Affected(stage_id=sid, reason=" ".join(str(a.get("reason") or "").split())[:300]))
    if kind == "wording":
        affected = []
    return ChangeImpact(kind=kind, affected=affected, calculations_hold=result.get("calculations_hold") is not False)


async def assess_change(
    client: OpenRouterClient, model: str | None, field: str, before: str, after: str, stages: list[StageConclusion]
) -> ChangeImpact:
    if not stages:
        return ChangeImpact()
    system, user = build_impact_prompt(field, before, after, stages)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=800, model=model)
    return parse_impact(result, {s.stage_id for s in stages})
