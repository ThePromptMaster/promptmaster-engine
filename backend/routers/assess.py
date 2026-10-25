"""Assess a pasted batch against the project's criteria (25 Oct).

A thin shell over `promptmaster.assessment`: the browser sends what was pasted,
the scale and the stage digest; the rows come back for it to append. Writes, so
it may search the web first while the project's Web access is on.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.assessment import MAX_ASSESS_CHARS, AssessBatchResult, AssessScale, assess_batch
from promptmaster.errors import PRESERVED_STAGE_VERSIONS
from promptmaster.limits import MAX_INSTRUCTION_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import PMInput, StageDigest, WebUse
from promptmaster.web_search import WebAccess, with_web
from routers._errors import llm_http_error
from routers.stage import _model_used

router = APIRouter(prefix="/api", tags=["assess"])


class AssessBatchRequest(BaseModel):
    inputs: PMInput
    digest: StageDigest = StageDigest()
    scale: AssessScale
    text: str = Field(min_length=1, max_length=MAX_ASSESS_CHARS)
    stage_hint: str = Field(default="", max_length=MAX_INSTRUCTION_CHARS)
    #: Subjects already in the table, so a re-paste is noticed.
    already: list[str] = Field(default_factory=list, max_length=500)
    model: str = ""
    web_access: WebAccess = "off"


class AssessBatchResponse(AssessBatchResult, WebUse):
    model_used: str = ""


@router.post("/assess-batch")
async def api_assess_batch(
    req: AssessBatchRequest,
    client: OpenRouterClient = Depends(get_client),
) -> AssessBatchResponse:
    """Judge each item in a pasted batch. 1 LLM call, plus a search when the web is on and wanted."""
    try:
        inputs, web = await with_web(
            client,
            req.model or None,
            req.inputs,
            req.web_access,
            task="Assess these items against the project's criteria:\n" + req.text[:1500],
        )
        result = await assess_batch(
            client=client,
            model=req.model or None,
            inputs=inputs,
            digest=req.digest,
            scale=req.scale,
            text=req.text,
            stage_hint=req.stage_hint,
            already=[s[:120] for s in req.already],
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_STAGE_VERSIONS)
    return AssessBatchResponse(
        **result.model_dump(),
        **web.model_dump(),
        model_used=_model_used(req.model, client),
    )
