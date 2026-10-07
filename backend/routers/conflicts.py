"""PM-24: does this instruction contradict the objective, a decision, or another instruction?"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.change_impact import ChangeImpact, StageConclusion, assess_change
from promptmaster.limits import MAX_CONTEXT_CHARS
from promptmaster.conflicts import Conflict, ConflictSource, ConflictStage, find_conflicts
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.limits import MAX_INSTRUCTION_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import PMInput
from routers._errors import llm_http_error

router = APIRouter(prefix="/api", tags=["conflicts"])


class CheckConflictsRequest(BaseModel):
    inputs: PMInput
    instruction: str = Field(min_length=1, max_length=MAX_INSTRUCTION_CHARS)
    decisions: list[ConflictSource] = Field(default_factory=list, max_length=30)
    other_instructions: list[ConflictSource] = Field(default_factory=list, max_length=20)
    #: The stage the instruction is for. Optional, for callers that predate it.
    stage: ConflictStage | None = None
    model: str = ""


class CheckConflictsResponse(BaseModel):
    conflicts: list[Conflict]


@router.post("/check-conflicts")
async def api_check_conflicts(
    req: CheckConflictsRequest, client: OpenRouterClient = Depends(get_client)
) -> CheckConflictsResponse:
    """One cheap JSON call. Never changes anything; the user decides what controls."""
    try:
        conflicts = await find_conflicts(
            client, req.model or None, req.inputs, req.instruction, req.decisions, req.other_instructions, req.stage
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return CheckConflictsResponse(conflicts=conflicts)


class AssessChangeRequest(BaseModel):
    #: `facts`: the accepted facts as a list, before and after one was added,
    #: changed or retired (F1, 7 Oct).
    field: str = Field(pattern="^(objective|audience|constraints|output_format|context|facts)$")
    before: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    after: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    stages: list[StageConclusion] = Field(default_factory=list, max_length=40)
    model: str = ""


@router.post("/assess-change")
async def api_assess_change(req: AssessChangeRequest, client: OpenRouterClient = Depends(get_client)) -> ChangeImpact:
    """Which finished stages relied on what changed in the brief (5 Oct). One
    call; nothing is written — the client records the result as an event."""
    try:
        return await assess_change(client, req.model or None, req.field, req.before, req.after, req.stages)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
