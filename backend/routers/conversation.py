"""Chat endpoints — fluid chat reply, apply-to-answer, save-as-new-version."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.conversation import (
    build_apply_to_answer_prompt,
    build_chat_reply_prompt,
    build_save_as_new_version_prompt,
)
from promptmaster.engine import generate
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import ChatMessage, Iteration, PMInput
from promptmaster.session_context import _label_trigger
from routers._pipeline import build_iteration_with_full_pipeline

router = APIRouter(prefix="/api", tags=["conversation"])


# --- Request / Response Models ---

class ChatMessageRequest(BaseModel):
    inputs: PMInput
    active_iteration: Iteration
    chat_history: list[ChatMessage] = []
    user_message: str
    iteration_history: list[Iteration] = []
    model: str = ""


class ChatMessageResponse(BaseModel):
    assistant_message: ChatMessage


class ApplyToAnswerRequest(BaseModel):
    inputs: PMInput
    active_iteration: Iteration
    chat_history: list[ChatMessage] = []
    iteration_number: int
    iteration_history: list[Iteration] = []
    model: str = ""


class SaveAsNewVersionRequest(BaseModel):
    inputs: PMInput
    active_iteration: Iteration
    chat_history: list[ChatMessage] = []
    iteration_number: int
    iteration_history: list[Iteration] = []
    model: str = ""


class IterationFromConversationResponse(BaseModel):
    iteration: Iteration
    suggestions: list[str]


# --- Helpers ---

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Endpoints ---

@router.post("/chat-message")
async def api_chat_message(
    req: ChatMessageRequest,
    client: OpenRouterClient = Depends(get_client),
) -> ChatMessageResponse:
    """Pure chat reply — 1 LLM call, no eval, no iteration created."""
    try:
        model = req.model or None
        system_text, prompt_text = build_chat_reply_prompt(
            inputs=req.inputs,
            active_iteration=req.active_iteration,
            chat_history=req.chat_history,
            user_message=req.user_message,
            iterations=req.iteration_history,
        )
        reply = await generate(
            client=client,
            prompt_text=prompt_text,
            system_text=system_text,
            model=model,
        )
        msg = ChatMessage(
            id=uuid.uuid4().hex,
            iteration_number=req.active_iteration.iteration_number,
            role="assistant",
            content=reply.strip(),
            created_at=_now_iso(),
        )
        return ChatMessageResponse(assistant_message=msg)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


@router.post("/apply-to-answer")
async def api_apply_to_answer(
    req: ApplyToAnswerRequest,
    client: OpenRouterClient = Depends(get_client),
) -> IterationFromConversationResponse:
    """Patch the active iteration's answer with conversation insights → new iteration."""
    try:
        model = req.model or None
        system_text, prompt_text = build_apply_to_answer_prompt(
            inputs=req.inputs,
            active_iteration=req.active_iteration,
            chat_history=req.chat_history,
            iterations=req.iteration_history,
        )
        output, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )
        trigger_source = "apply_conversation"
        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=output,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source=trigger_source,
            active_iteration=req.active_iteration,
            chat_history=req.chat_history,
            iteration_history=req.iteration_history,
            user_action_label=_label_trigger(trigger_source),
            finish_reason=finish_reason,
        )
        return IterationFromConversationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


@router.post("/save-as-new-version")
async def api_save_as_new_version(
    req: SaveAsNewVersionRequest,
    client: OpenRouterClient = Depends(get_client),
) -> IterationFromConversationResponse:
    """Generate a fresh new version using chat as guidance → new iteration."""
    try:
        model = req.model or None
        system_text, prompt_text = build_save_as_new_version_prompt(
            inputs=req.inputs,
            active_iteration=req.active_iteration,
            chat_history=req.chat_history,
            iterations=req.iteration_history,
        )
        output, _usage, finish_reason = await client.generate_with_meta(
            prompt=prompt_text,
            system=system_text,
            model=model,
        )
        trigger_source = "refined_from_conversation"
        iteration, suggestions = await build_iteration_with_full_pipeline(
            client=client,
            model=model,
            inputs=req.inputs,
            output=output,
            iteration_number=req.iteration_number,
            system_text=system_text,
            prompt_text=prompt_text,
            trigger_source=trigger_source,
            active_iteration=req.active_iteration,
            chat_history=req.chat_history,
            iteration_history=req.iteration_history,
            user_action_label=_label_trigger(trigger_source),
            finish_reason=finish_reason,
        )
        return IterationFromConversationResponse(iteration=iteration, suggestions=suggestions)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
