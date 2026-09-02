"""Engine endpoints: prompt building, iteration, realignment, audit."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from promptmaster.schemas import PMInput, AssembledPrompt, EvaluationResult
from promptmaster.prompt_builder import build_prompt
from promptmaster.engine import (
    format_session_summary,
    export_session_json,
    generate_hard_reset_lessons,
    run_self_audit,
)
from promptmaster.schemas import Iteration
from promptmaster.realigner import build_realignment_prompt
from promptmaster.session_context import _label_trigger
from promptmaster.flow_triggers import (
    build_flow_trigger_prompt,
    run_check_intent,
    run_confirm_understanding,
    run_analyze_pattern,
    run_ask_questions,
    FlowTriggerType,
    FlowInspectType,
)
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._pipeline import build_iteration_with_full_pipeline
from deps import get_client

# Triggers that produce commentary *about* the previous answer rather than a
# replacement for it. They are returned unevaluated: scoring a critique against
# the original objective would be meaningless.
DIAGNOSTIC_TRIGGERS = ("challenge", "self_audit", "reframe")

router = APIRouter(prefix="/api", tags=["engine"])


# --- Request/Response Models ---

class BuildPromptRequest(BaseModel):
    inputs: PMInput


class RunIterationRequest(BaseModel):
    inputs: PMInput
    prompt_text: str
    system_text: str
    iteration_number: int
    model: str = ""
    # Prior iterations in this session (for LLM context)
    iteration_history: list[Iteration] = []
    # Where this iteration came from: 'initial', 'refine', 'realignment'
    source: str = "initial"


class RunIterationResponse(BaseModel):
    iteration: Iteration
    suggestions: list[str]


class RealignmentRequest(BaseModel):
    inputs: PMInput
    evaluation: EvaluationResult
    iteration_history: list[Iteration] = []
    model: str = ""


class RealignmentResponse(BaseModel):
    realignment_prompt: str


class AuditRequest(BaseModel):
    inputs: PMInput
    iterations: list[Iteration]
    model: str = ""


class SummaryRequest(BaseModel):
    inputs: PMInput
    iterations: list[Iteration]


class ExportRequest(BaseModel):
    inputs: PMInput
    iterations: list[Iteration]
    model: str = ""


class FlowTriggerRequest(BaseModel):
    inputs: PMInput
    current_output: str
    trigger: FlowTriggerType
    iteration_number: int
    evaluation: EvaluationResult | None = None
    iteration_history: list[Iteration] = []
    model: str = ""


class FlowInspectRequest(BaseModel):
    inputs: PMInput
    current_output: str
    inspection: FlowInspectType
    iteration_history: list[Iteration] = []
    model: str = ""


class FlowInspectResponse(BaseModel):
    kind: FlowInspectType
    text: str | None = None
    questions: list[str] | None = None


# --- Endpoints ---

@router.post("/build-prompt")
async def api_build_prompt(req: BuildPromptRequest) -> AssembledPrompt:
    """Assemble an optimized prompt from user inputs. No LLM call."""
    return build_prompt(req.inputs)


@router.post("/run-iteration")
async def api_run_iteration(
    req: RunIterationRequest,
    client: OpenRouterClient = Depends(get_client),
) -> RunIterationResponse:
    """Run one generate-evaluate cycle. Generate first, then evaluate + suggestions + summary in parallel."""
    try:
        model = req.model or None
        history = req.iteration_history

        # Step 1: Generate output (must complete first) — capture finish_reason for completeness pre-filter
        output, _usage, finish_reason = await client.generate_with_meta(
            prompt=req.prompt_text,
            system=req.system_text,
            model=model,
        )

        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=output,
            iteration_number=req.iteration_number,
            system_text=req.system_text,
            prompt_text=req.prompt_text,
            trigger_source=req.source,
            # None on the first iteration — nothing to summarise a change against.
            active_iteration=history[-1] if history else None,
            chat_history=[],
            iteration_history=history,
            user_action_label=_label_trigger(req.source),
            finish_reason=finish_reason,
        )

        return RunIterationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/flow-trigger")
async def api_flow_trigger(
    req: FlowTriggerRequest,
    client: OpenRouterClient = Depends(get_client),
) -> RunIterationResponse:
    """Run a one-click flow trigger (Challenge, Self-Audit, Drift Alert, Refine).

    Builds a pre-configured prompt from the book's Ch1 S13-S14 techniques,
    then runs the full pipeline: generate -> (evaluate || suggestions || summary).

    Diagnostic triggers are the exception: they produce commentary about the
    previous answer rather than a replacement for it, so they are returned
    unevaluated and without suggestions.
    """
    try:
        model = req.model or None
        history = req.iteration_history

        system_text, prompt_text = build_flow_trigger_prompt(
            inputs=req.inputs,
            current_output=req.current_output,
            trigger=req.trigger,
            evaluation=req.evaluation,
            iterations=history,
        )

        output, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )

        if req.trigger in DIAGNOSTIC_TRIGGERS:
            iteration = Iteration(
                iteration_number=req.iteration_number,
                prompt_sent=prompt_text,
                system_prompt_used=system_text,
                output=output,
                mode=req.inputs.mode,
                evaluation=None,
                trigger_source=req.trigger,
                created_at=datetime.now(timezone.utc).isoformat(),
                model_used=model or "",
                instruction=_label_trigger(req.trigger),
            )
            return RunIterationResponse(iteration=iteration, suggestions=[])

        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=output,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source=req.trigger,
            active_iteration=history[-1] if history else None,
            chat_history=[],
            iteration_history=history,
            user_action_label=_label_trigger(req.trigger),
            finish_reason=finish_reason,
            instruction=_label_trigger(req.trigger),
        )

        return RunIterationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/flow-inspect")
async def api_flow_inspect(
    req: FlowInspectRequest,
    client: OpenRouterClient = Depends(get_client),
) -> FlowInspectResponse:
    """Lightweight inspection calls: Check Intent (Shadow Prompt) or Ask Questions (Reverse Q&A).

    No iteration is created — just returns insight text or a list of questions.
    """
    try:
        model = req.model or None
        history = req.iteration_history
        if req.inspection == "check_intent":
            text = await run_check_intent(
                client=client,
                inputs=req.inputs,
                current_output=req.current_output,
                iterations=history,
                model=model,
            )
            return FlowInspectResponse(kind="check_intent", text=text)
        if req.inspection == "confirm_understanding":
            text = await run_confirm_understanding(
                client=client,
                inputs=req.inputs,
                current_output=req.current_output,
                iterations=history,
                model=model,
            )
            return FlowInspectResponse(kind="confirm_understanding", text=text)
        if req.inspection == "analyze_pattern":
            text = await run_analyze_pattern(
                client=client,
                inputs=req.inputs,
                current_output=req.current_output,
                iterations=history,
                model=model,
            )
            return FlowInspectResponse(kind="analyze_pattern", text=text)
        if req.inspection == "ask_questions":
            questions = await run_ask_questions(
                client=client,
                inputs=req.inputs,
                current_output=req.current_output,
                iterations=history,
                model=model,
            )
            return FlowInspectResponse(kind="ask_questions", questions=questions)
        raise HTTPException(status_code=400, detail=f"Unknown inspection type: {req.inspection}")
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/build-realignment")
async def api_build_realignment(
    req: RealignmentRequest,
    client: OpenRouterClient = Depends(get_client),
) -> RealignmentResponse:
    """Build a realignment prompt. 1-2 LLM calls."""
    try:
        prompt = await build_realignment_prompt(
            client=client,
            inputs=req.inputs,
            evaluation=req.evaluation,
            iterations=req.iteration_history,
            model=req.model or None,
        )
        return RealignmentResponse(realignment_prompt=prompt)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/run-self-audit")
async def api_run_self_audit(
    req: AuditRequest,
    client: OpenRouterClient = Depends(get_client),
) -> dict:
    """Run Cold Critic self-audit. 1 LLM call."""
    try:
        audit = await run_self_audit(
            client=client,
            inputs=req.inputs,
            iterations=req.iterations,
            model=req.model or None,
        )
        return {"audit": audit}
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/hard-reset-lessons")
async def api_hard_reset_lessons(
    req: AuditRequest,
    client: OpenRouterClient = Depends(get_client),
) -> dict:
    """Generate lessons before hard reset. 1 LLM call."""
    try:
        lessons = await generate_hard_reset_lessons(
            client=client,
            inputs=req.inputs,
            iterations=req.iterations,
            model=req.model or None,
        )
        return {"lessons": lessons}
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/format-summary")
async def api_format_summary(req: SummaryRequest) -> dict:
    """Generate copyable session summary text. No LLM call."""
    summary = format_session_summary(req.inputs, req.iterations)
    return {"summary": summary}


@router.post("/export-session")
async def api_export_session(req: ExportRequest) -> dict:
    """Export session as JSON. No LLM call."""
    json_str = export_session_json(req.inputs, req.iterations, model=req.model)
    return {"json": json_str}
