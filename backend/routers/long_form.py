"""Long-form document orchestration endpoints.

All stateless. The backend owns no Supabase client and no job state: the drain
(a Next.js route handler holding the service-role key) reads the outline and
continuity records, calls these endpoints for generation only, and writes the
results back itself.

- POST /api/detect-long-form        — classifier (1 LLM call)
- POST /api/generate-outline        — outline generator (1 LLM call)
- POST /api/generate-section        — legacy: section + snapshot welded (2 LLM calls)
- POST /api/generate-section-prose  — just the prose (1 LLM call)
- POST /api/extract-section-record  — just the FR-06 record (1 LLM call)
- POST /api/finalize-long-form      — eval + suggestions + summary on merged content (3 parallel calls)

/api/generate-section is the pair of calls the two endpoints below split apart.
The split is the whole point of FR-05: the drain commits the prose the instant
it returns, so a function timeout during extraction costs one cheap call rather
than a section the user has already paid for.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.long_form import (
    detect_long_form,
    extract_section_record,
    generate_outline,
    generate_section,
    generate_section_prose,
)
from promptmaster.schemas import (
    ContinuitySnapshot,
    DetectLongFormResponse,
    ExtractSectionRecordResponse,
    GenerateOutlineResponse,
    GenerateSectionProseResponse,
    GenerateSectionResponse,
    Iteration,
    OutlineSection,
    PMInput,
    SectionRecord,
)
from promptmaster.session_context import _label_trigger
from routers._pipeline import build_iteration_with_full_pipeline

# Reuse the existing IterationFromConversationResponse shape
from routers.conversation import IterationFromConversationResponse

router = APIRouter(prefix="/api", tags=["long_form"])


# -------- request bodies --------

class DetectRequest(BaseModel):
    inputs: PMInput
    model: str = ""


class GenerateOutlineRequest(BaseModel):
    inputs: PMInput
    suggested_section_count: int = 8
    model: str = ""


class GenerateSectionRequest(BaseModel):
    inputs: PMInput
    outline: list[OutlineSection]
    section_index: int
    prior_snapshot: ContinuitySnapshot | None = None
    prev_section_content: str = ""
    model: str = ""


class GenerateSectionProseRequest(BaseModel):
    inputs: PMInput
    outline: list[OutlineSection]
    section_index: int
    #: FR-06 records. Preferred over prior_snapshot; both are optional so the
    #: first section of a document sends neither.
    records: list[SectionRecord] = []
    prior_snapshot: ContinuitySnapshot | None = None
    prev_section_content: str = ""
    model: str = ""


class ExtractSectionRecordRequest(BaseModel):
    section_id: str
    section_index: int
    section_title: str = ""
    section_content: str
    #: Term names only — definitions are not resent, which is what keeps this
    #: call's input constant as the glossary grows.
    existing_terms: list[str] = []
    model: str = ""


class FinalizeLongFormRequest(BaseModel):
    inputs: PMInput
    merged_content: str
    outline: list[OutlineSection]
    iteration_number: int
    iteration_history: list[Iteration] = []
    #: Worst finish_reason across the sections. Hardcoding "stop" here defeated
    #: truncation detection for the whole document: a section that hit the token
    #: limit was merged in and then declared complete.
    finish_reason: str = ""
    model: str = ""


def _document_finish_reason(req: FinalizeLongFormRequest) -> str:
    """The document is truncated if ANY of its sections was.

    This used to be the literal string "stop", which meant the completeness
    override in _pipeline (finish_reason == "length" -> incomplete) could never
    fire for a long-form document: a section cut off mid-sentence was merged in
    and the finished document was then scored as complete. An explicit request
    value wins; otherwise it is derived from the sections that were actually
    written, which is the information the caller already has.
    """
    if req.finish_reason:
        return req.finish_reason
    if any(s.finish_reason == "length" for s in req.outline):
        return "length"
    return "stop"


# -------- endpoints --------

@router.post("/detect-long-form", response_model=DetectLongFormResponse)
async def api_detect_long_form(
    req: DetectRequest,
    client: OpenRouterClient = Depends(get_client),
):
    # Defensive try/except matches the sibling-router pattern (e.g. continuation.py).
    # detect_long_form currently swallows all exceptions and returns a safe default,
    # so this never fires today — kept for consistency and future-proofing.
    try:
        return await detect_long_form(client=client, model=req.model or None, inputs=req.inputs)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/generate-outline", response_model=GenerateOutlineResponse)
async def api_generate_outline(
    req: GenerateOutlineRequest,
    client: OpenRouterClient = Depends(get_client),
):
    try:
        outline = await generate_outline(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            suggested_section_count=req.suggested_section_count,
        )
        return GenerateOutlineResponse(outline=outline)
    except (OpenRouterError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/generate-section", response_model=GenerateSectionResponse)
async def api_generate_section(
    req: GenerateSectionRequest,
    client: OpenRouterClient = Depends(get_client),
):
    """Generate one section + regenerate the rolling continuity snapshot.

    Only OpenRouterError is expected; anything else is a programmer error
    and propagates as a 500.
    """
    if req.section_index < 0 or req.section_index >= len(req.outline):
        raise HTTPException(status_code=400, detail=f"section_index {req.section_index} out of range")
    try:
        return await generate_section(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            outline=req.outline,
            section_index=req.section_index,
            prior_snapshot=req.prior_snapshot,
            prev_section_content=req.prev_section_content,
        )
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/finalize-long-form", response_model=IterationFromConversationResponse)
async def api_finalize_long_form(
    req: FinalizeLongFormRequest,
    client: OpenRouterClient = Depends(get_client),
):
    """Run eval + suggestions + summary on the pre-generated merged document.

    The merged content comes from the frontend (sum of all section.content).
    No regeneration here — just the pipeline pass.
    """
    if not req.merged_content.strip():
        raise HTTPException(status_code=400, detail="merged_content is empty")

    # Synthetic system/prompt text for the iteration record
    system_text = f"Long-form document with {len(req.outline)} sections."
    prompt_text = req.inputs.objective

    # active_iteration must exist for build_iteration_with_full_pipeline; use the last
    # iteration in history if any, else a synthetic initial iteration so the summary call
    # has a coherent "before" state to compare against.
    active = req.iteration_history[-1] if req.iteration_history else Iteration(
        iteration_number=1,
        prompt_sent="",
        system_prompt_used="",
        output="(no prior iteration — first long-form finalize)",
        mode=req.inputs.mode,
        evaluation=None,
        trigger_source="initial",
    )

    try:
        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            output=req.merged_content,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source="long_form_finalize",
            active_iteration=active,
            chat_history=[],
            iteration_history=req.iteration_history,
            user_action_label=_label_trigger("long_form_finalize"),
            finish_reason=_document_finish_reason(req),
        )
        return IterationFromConversationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/generate-section-prose", response_model=GenerateSectionProseResponse)
async def api_generate_section_prose(
    req: GenerateSectionProseRequest,
    client: OpenRouterClient = Depends(get_client),
):
    """Write one section and return it. No continuity work, no persistence.

    Kept deliberately narrow so the caller can commit the result before doing
    anything else with it.
    """
    if req.section_index < 0 or req.section_index >= len(req.outline):
        raise HTTPException(status_code=400, detail=f"section_index {req.section_index} out of range")
    try:
        return await generate_section_prose(
            client=client,
            model=req.model or None,
            inputs=req.inputs,
            outline=req.outline,
            section_index=req.section_index,
            prior_snapshot=req.prior_snapshot,
            prev_section_content=req.prev_section_content,
            records=req.records or None,
        )
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")


@router.post("/extract-section-record", response_model=ExtractSectionRecordResponse)
async def api_extract_section_record(
    req: ExtractSectionRecordRequest,
    client: OpenRouterClient = Depends(get_client),
):
    """Extract the FR-06 continuity record for one already-written section."""
    if not req.section_content.strip():
        raise HTTPException(status_code=400, detail="section_content is empty")
    try:
        record = await extract_section_record(
            client=client,
            model=req.model or None,
            section_id=req.section_id,
            section_index=req.section_index,
            section_title=req.section_title,
            section_content=req.section_content,
            existing_terms=req.existing_terms,
        )
        return ExtractSectionRecordResponse(record=record)
    except OpenRouterError as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")
