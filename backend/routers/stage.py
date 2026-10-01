"""Stage artifact generation — the one endpoint every stage of every workflow uses.

One route rather than one per stage kind, for the same reason there is one
renderer set rather than one component per workflow: the difference between an
Audience stage and a fact-check stage is data (an instruction and an item
schema), and expressing it as data is what keeps Book and Research on one
engine.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_EVALUATION, PRESERVED_STAGE_VERSIONS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import (
    GenerateStageArtifactResponse,
    Iteration,
    OutlineSection,
    PMInput,
    StageDescriptor,
    StageDigest,
    StageEvaluationResponse,
    StageItemSchema,
)
from promptmaster.figures import Figure, extract_figures
from promptmaster.stage import generate_stage_artifact
from routers._errors import llm_http_error
from promptmaster.stage_evaluation import evaluate_stage_artifact

router = APIRouter(prefix="/api", tags=["stage"])


def _model_used(requested: str, client: OpenRouterClient) -> str:
    """The model a call actually ran on, for FR-10 provenance.

    A project that never picked a model sends "" and the client falls back to
    its default; recording the "" would leave the version unattributable.
    """
    if requested:
        return requested
    default = getattr(client, "model", "")
    return default if isinstance(default, str) else ""


class GenerateStageArtifactRequest(BaseModel):
    inputs: PMInput
    stage: StageDescriptor
    digest: StageDigest = StageDigest()
    # Present only for list and review stages. Optional rather than required so
    # a template that has not declared a shape still generates something.
    item_schema: StageItemSchema | None = None
    # What the stage already holds, when the user asked to regenerate.
    existing_content: str = ""
    # What to change about it: a revision instruction from the user or Go mode.
    instruction: str = Field(default="", max_length=4_000)
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
        result = await generate_stage_artifact(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            stage=req.stage,
            digest=req.digest,
            item_schema=req.item_schema,
            existing_content=req.existing_content,
            instruction=req.instruction,
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_STAGE_VERSIONS)
    result.model_used = _model_used(req.model, client)
    return result


class EvaluateStageArtifactRequest(BaseModel):
    inputs: PMInput
    stage: StageDescriptor
    # What is actually being judged. Prose stages send Markdown; list and
    # review stages send the serialised item document, which is what the
    # version row holds — so the evaluator sees the artifact as stored.
    content: str
    digest: StageDigest = StageDigest()
    # FR-12's fourth axis. Absent for a project with no approved outline, which
    # the prompt states in words rather than dropping the axis silently.
    approved_outline: list[OutlineSection] = []
    iterations: list[Iteration] = []
    model: str = ""


@router.post("/evaluate-stage-artifact")
async def api_evaluate_stage_artifact(
    req: EvaluateStageArtifactRequest,
    client: OpenRouterClient = Depends(get_client),
) -> StageEvaluationResponse:
    """Evaluate one stage's artifact. 1 LLM call. FR-11, FR-12.

    User-triggered, never automatic on generation: the product decision is that
    the cost is visible and chosen. Deliberately not the full iteration
    pipeline, for the reason `generate-stage-artifact` gives — that pipeline is
    four calls scoring against `inputs.objective`, and this one judges the
    artifact against the stage's declared intent instead.
    """
    try:
        result = await evaluate_stage_artifact(
            client=client,
            inputs=req.inputs,
            stage=req.stage,
            content=req.content,
            digest=req.digest,
            approved_outline=req.approved_outline or None,
            iterations=req.iterations,
            model=req.model or None,
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_EVALUATION)
    result.model_used = _model_used(req.model, client)
    return result


class ExtractFiguresRequest(BaseModel):
    stage_label: str = ""
    content: str = Field(min_length=1, max_length=400_000)
    model: str = ""


class ExtractFiguresResponse(BaseModel):
    figures: list[Figure]


@router.post("/extract-figures")
async def api_extract_figures(
    req: ExtractFiguresRequest,
    client: OpenRouterClient = Depends(get_client),
) -> ExtractFiguresResponse:
    """The figures a finished stage established, each exactly as written. One
    small JSON call; a value that is not in the text is dropped. Never a gate:
    the client calls it when a stage completes and carries on if it fails."""
    try:
        figures = await extract_figures(client, req.model or None, req.stage_label, req.content)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_STAGE_VERSIONS)
    return ExtractFiguresResponse(figures=figures)
