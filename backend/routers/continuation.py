"""Continue Document endpoint — completes truncated/depth-collapsed outputs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.continuity import (
    build_continuation_prompt,
    generate_continuity_snapshot,
)
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import Iteration, PMInput
from promptmaster.session_context import _label_trigger
from routers._pipeline import build_iteration_with_full_pipeline

# Reuse the existing IterationFromConversationResponse shape from conversation.py
from routers.conversation import IterationFromConversationResponse

router = APIRouter(prefix="/api", tags=["continuation"])


class ContinueDocumentRequest(BaseModel):
    inputs: PMInput
    incomplete_iteration: Iteration
    iteration_number: int
    iteration_history: list[Iteration] = []
    model: str = ""


@router.post("/continue-document")
async def api_continue_document(
    req: ContinueDocumentRequest,
    client: OpenRouterClient = Depends(get_client),
) -> IterationFromConversationResponse:
    """Generate a snapshot, then continue from where the previous output trails off.

    Pipeline:
      1. Generate continuity snapshot (1 small generate_json call)
      2. Build continuation prompt with snapshot + previous output
      3. Generate continuation text (1 generate_with_meta call)
      4. Merge: new_output = previous_output + "\\n\\n" + continuation_text
      5. Run eval + suggestions + summary in parallel on merged output
      6. Return new iteration (trigger_source='continuation', continuity_snapshot attached)
    """
    try:
        model = req.model or None

        # Step 1: snapshot
        snapshot = await generate_continuity_snapshot(
            client=client,
            model=model,
            inputs=req.inputs,
            previous_output=req.incomplete_iteration.output,
        )

        # Step 2: build continuation prompt
        system_text, prompt_text = build_continuation_prompt(
            inputs=req.inputs,
            incomplete_iteration=req.incomplete_iteration,
            snapshot=snapshot,
            iterations=req.iteration_history,
        )

        # Step 3: generate continuation
        continuation_text, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )

        # Step 4: merge
        merged_output = req.incomplete_iteration.output.rstrip() + "\n\n" + continuation_text.lstrip()

        # Step 5: pipeline (eval + suggestions + summary in parallel; finish_reason override applied)
        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=merged_output,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source="continuation",
            active_iteration=req.incomplete_iteration,
            chat_history=[],
            iteration_history=req.iteration_history,
            user_action_label=_label_trigger("continuation"),
            finish_reason=finish_reason,
        )

        # Step 6: attach snapshot to the resulting iteration
        iteration = iteration.model_copy(update={"continuity_snapshot": snapshot})

        return IterationFromConversationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
