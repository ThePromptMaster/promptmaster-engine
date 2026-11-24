"""Which stages of a project depend on a rule the user has not settled yet? (24 Nov)

Sean, 23 Nov: "If the two instructions are still in conflict, pause the reference
work that depends on the answer and let the rest of the search continue."

One small call reads the two statements that disagree beside each stage's name and
instruction, and names the stages whose work turns on which one holds, each with
the words of the stage's own name or instruction that show it, found there in code.
Matching words would not do: "Referencing" against "due diligence", or a stage
written in Spanish. Any failure names none: nothing is held, and the user still sees
the mismatch and the choice. A check, so it never searches the web.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient

CONCERNED_MODEL = "anthropic/claude-sonnet-5.5"

MAX_STAGES = 30

CONCERNED_INSTRUCTION = (
    "Two instructions about the same work disagree, and the user has not chosen between them yet. You are "
    "given the two, and the stages of one project, each with its name and what it is told to do. Name each "
    "stage whose work cannot be done properly until the user chooses: it does, plans, writes up or assigns "
    "the very thing the two disagree about. A stage that only mentions the subject in passing, or whose "
    "work is the same whichever holds, is not one. If you are unsure, leave it out.\n\n"
    "For each stage give:\n"
    "- stage_id: the stage's id\n"
    "- quote: the words of that stage's own name or instruction that show it depends, copied exactly, 4 to 200 characters\n\n"
    'Return JSON only: {"stages": [{"stage_id": "...", "quote": "..."}]}. An empty list when none depend on it.'
)


class ConcernedStage(BaseModel):
    id: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=300)
    instruction: str = Field(default="", max_length=4_000)


class StagesConcernedRequest(BaseModel):
    rule: str = Field(..., min_length=1, max_length=2_000)
    statement: str = Field(..., min_length=1, max_length=2_000)
    explanation: str = Field(default="", max_length=600)
    stages: list[ConcernedStage] = Field(default_factory=list, max_length=MAX_STAGES)
    model: str = Field(default="", max_length=200)


class StageConcerned(BaseModel):
    stage_id: str
    quote: str


class StagesConcernedResponse(BaseModel):
    stages: list[StageConcerned] = Field(default_factory=list)
    #: False when the check did not run (a failure): nothing is recorded, and it is read again later.
    checked: bool = False


def build_concerned_prompt(req: StagesConcernedRequest) -> tuple[str, str]:
    stages = "\n\n".join(
        f"[{s.id}] {' '.join(s.label.split())}\nINSTRUCTION: {' '.join(s.instruction.split())[:1_500] or '(none)'}" for s in req.stages
    )
    user = (
        f"FIRST INSTRUCTION: {' '.join(req.rule.split())}\n"
        f"SECOND INSTRUCTION: {' '.join(req.statement.split())}\n"
        + (f"WHAT THEY DISAGREE ABOUT: {' '.join(req.explanation.split())}\n" if req.explanation.strip() else "")
        + f"\nSTAGES:\n{stages}"
    )
    return CONCERNED_INSTRUCTION, user


def _found_short(quote: str, *texts: str) -> bool:
    """`_found` wants 8 characters; a stage name ("Referencing") can be shorter."""
    if len(quote.strip()) >= 8:
        return _found(quote, *texts)
    q = " ".join(quote.lower().split())
    return len(q) >= 4 and any(q in " ".join(t.lower().split()) for t in texts)


def parse_concerned(result: object, req: StagesConcernedRequest) -> StagesConcernedResponse:
    """A stage is named only with words found in its own name or instruction."""
    if not isinstance(result, dict):
        return StagesConcernedResponse()
    stages = {s.id: s for s in req.stages}
    out: list[StageConcerned] = []
    seen: set[str] = set()
    for raw in result.get("stages") or []:
        if not isinstance(raw, dict):
            continue
        sid = str(raw.get("stage_id") or "").strip().strip("[]")
        quote = " ".join(str(raw.get("quote") or "").split()).strip('"“”')[:200]
        stage = stages.get(sid)
        if not stage or sid in seen or not quote or not _found_short(quote, stage.label, stage.instruction):
            continue
        seen.add(sid)
        out.append(StageConcerned(stage_id=sid, quote=quote))
    return StagesConcernedResponse(stages=out, checked=True)


async def stages_concerned(client: OpenRouterClient, req: StagesConcernedRequest) -> StagesConcernedResponse:
    if not req.stages:
        return StagesConcernedResponse(checked=True)
    system, user = build_concerned_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=600, model=CONCERNED_MODEL)
    return parse_concerned(result, req)
