"""Stage artifact generation — the one endpoint every stage of every workflow uses.

One route rather than one per stage kind, for the same reason there is one
renderer set rather than one component per workflow: the difference between an
Audience stage and a fact-check stage is data (an instruction and an item
schema), and expressing it as data is what keeps Book and Research on one
engine.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import (
    GenerateStageArtifactResponse,
    PMInput,
    StageDescriptor,
    StageDigest,
    StageItemSchema,
)
from promptmaster.stage import generate_stage_artifact

router = APIRouter(prefix="/api", tags=["stage"])


class GenerateStageArtifactRequest(BaseModel):
    inputs: PMInput
    stage: StageDescriptor
    digest: StageDigest = StageDigest()
    # Present only for list and review stages. Optional rather than required so
    # a template that has not declared a shape still generates something.
    item_schema: StageItemSchema | None = None
    # What the stage already holds, when the user asked to regenerate.
    existing_content: str = ""
    model: str = ""


@router.post("/generate-stage-artifact")
async def api_generate_stage_artifact(
    req: GenerateStageArtifactRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GenerateStageArtifactResponse:
    """Draft one stage's artifact. 1 LLM call.

    Deliberately not the full iteration pipeline: that scores against the
    project objective, which is the wrong question for a stage whose job is to
    produce audience segments, and costs four calls where one will do.
    """
    try:
        return await generate_stage_artifact(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            stage=req.stage,
            digest=req.digest,
            item_schema=req.item_schema,
            existing_content=req.existing_content,
        )
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")
