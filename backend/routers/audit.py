"""Audit -> Action endpoints — produce structured findings, apply selected ones.

`/api/apply-recommendations` (M4.2, FR-09) lives here rather than in a router of
its own because it reuses this module's prompt builder verbatim: a
recommendation casts to an `AuditFinding`, so applying one is applying a finding
under a different name.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.audit_findings import (
    _format_findings_block,
    build_apply_audit_prompt,
    generate_audit_findings,
)
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import AuditFinding, Iteration, PMInput
from promptmaster.session_context import _label_trigger
from routers._pipeline import build_iteration_with_full_pipeline

# Reuse the existing IterationFromConversationResponse shape from conversation.py
from routers.conversation import IterationFromConversationResponse

router = APIRouter(prefix="/api", tags=["audit"])


# --- Request / Response models ---

class AuditFindingsRequest(BaseModel):
    inputs: PMInput
    current_output: str
    iteration_history: list[Iteration] = []
    model: str = ""


class AuditFindingsResponse(BaseModel):
    findings: list[AuditFinding]


class ApplyAuditRequest(BaseModel):
    inputs: PMInput
    source_iteration: Iteration
    findings: list[AuditFinding]
    iteration_number: int
    iteration_history: list[Iteration] = []
    model: str = ""


class ApplyRecommendationsRequest(BaseModel):
    """One or more accepted recommendations, applied to a stage's artifact (FR-09).

    `findings` is the recommendation list already cast to the AuditFinding
    shape by the caller: `{id, category: kind, summary: title,
    suggested_change: instruction}`. That cast is why this endpoint needs no
    prompt text of its own — `build_apply_audit_prompt` formats exactly these
    fields, so the combined instruction the user read in the preview dialog is
    the combined instruction the model receives.
    """

    inputs: PMInput
    # The artifact as stored, rather than a whole Iteration. The workspace
    # holds ArtifactVersion rows, which have no evaluation, no iteration
    # number and no trigger source; making the client fabricate those to
    # satisfy a schema would be inventing provenance to pass a type check.
    content: str
    findings: list[AuditFinding]
    model: str = ""


class ApplyRecommendationsResponse(BaseModel):
    content: str
    #: What was sent, so the caller can store it as the version's `instruction`
    #: (FR-10 provenance) without rebuilding the string and risking a mismatch.
    instruction: str
    finish_reason: str = ""


# --- Endpoints ---

@router.post("/audit-findings")
async def api_audit_findings(
    req: AuditFindingsRequest,
    client: OpenRouterClient = Depends(get_client),
) -> AuditFindingsResponse:
    """Run the audit and return structured findings. 1 LLM call.

    Empty list on LLM failure or malformed response (graceful degrade).
    """
    try:
        findings = await generate_audit_findings(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            current_output=req.current_output,
            iterations=req.iteration_history,
        )
        return AuditFindingsResponse(findings=findings)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


@router.post("/apply-audit")
async def api_apply_audit(
    req: ApplyAuditRequest,
    client: OpenRouterClient = Depends(get_client),
) -> IterationFromConversationResponse:
    """Apply selected audit findings -> new iteration. 4 LLM calls (1 + 3 parallel)."""
    try:
        model = req.model or None
        system_text, prompt_text = build_apply_audit_prompt(
            inputs=req.inputs,
            source_iteration=req.source_iteration,
            findings=req.findings,
            iterations=req.iteration_history,
        )

        # Generation
        revised_output, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )

        # Pipeline: eval + suggestions + summary in parallel; finish_reason override
        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=revised_output,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source="applied_audit",
            active_iteration=req.source_iteration,
            chat_history=[],
            iteration_history=req.iteration_history,
            user_action_label=_label_trigger("applied_audit"),
            finish_reason=finish_reason,
        )
        return IterationFromConversationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


@router.post("/apply-recommendations")
async def api_apply_recommendations(
    req: ApplyRecommendationsRequest,
    client: OpenRouterClient = Depends(get_client),
) -> ApplyRecommendationsResponse:
    """Apply accepted recommendations to a stage's artifact. **1 LLM call.** FR-09.

    Deliberately not `/api/apply-audit`, which does the same revision and then
    four calls' worth of work on top: it runs the full iteration pipeline, which
    scores the result against `inputs.objective`. That is the wrong bar for a
    stage artifact, by exactly the argument `stage_evaluation.py` already makes
    — a list of audience segments judged against the book's objective is judged
    against the wrong thing — and the pipeline's three extra results would be
    discarded here anyway.

    The prompt is `build_apply_audit_prompt`, unchanged and unwrapped. A
    recommendation casts cleanly to `AuditFinding`, so this milestone adds no
    prompt text at all, and the block the user approved in the preview dialog is
    byte-for-byte the block that reaches the model.
    """
    try:
        model = req.model or None

        # A minimal Iteration purely to feed the existing builder, which reads
        # `.output` from it and nothing else. Constructed here rather than
        # demanded from the client, so no caller has to invent an iteration
        # number or an evaluation that never happened in order to pass a schema.
        source = Iteration(
            iteration_number=1,
            prompt_sent="",
            output=req.content,
            mode=req.inputs.mode,
            trigger_source="applied_recommendations",
        )

        system_text, prompt_text = build_apply_audit_prompt(
            inputs=req.inputs,
            source_iteration=source,
            findings=req.findings,
            iterations=[],
        )

        revised, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )

        return ApplyRecommendationsResponse(
            content=revised,
            # Returned rather than recomputed by the caller: the version row
            # stores it as FR-10 provenance, and two places building the same
            # string is two places for it to drift.
            instruction=_format_findings_block(req.findings),
            finish_reason=finish_reason or "",
        )
    except OpenRouterError as e:
        # Lane C's classified detail rather than a bare string: applying a
        # recommendation writes nothing until it succeeds, so the preservation
        # clause is the honest one.
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
