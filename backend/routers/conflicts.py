"""PM-24: does this instruction contradict the objective, a decision, or another instruction?"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.conflicts import Conflict, ConflictSource, find_conflicts
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import PMInput
from routers._errors import llm_http_error

router = APIRouter(prefix="/api", tags=["conflicts"])


class CheckConflictsRequest(BaseModel):
    inputs: PMInput
    instruction: str = Field(min_length=1, max_length=4_000)
    decisions: list[ConflictSource] = Field(default_factory=list, max_length=30)
    other_instructions: list[ConflictSource] = Field(default_factory=list, max_length=20)
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
            client, req.model or None, req.inputs, req.instruction, req.decisions, req.other_instructions
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return CheckConflictsResponse(conflicts=conflicts)
