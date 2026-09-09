"""Audit -> Action endpoints — produce structured findings, apply selected ones."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.audit_findings import (
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
