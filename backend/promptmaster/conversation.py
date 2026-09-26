"""Prompt builders for the chat / apply / save-as-new-version flows.

Three flows share a common scaffolding (objective, audience, constraints,
session history with rating signals) and differ only in the system-prompt
instruction and what they put in the user message.
"""

from __future__ import annotations

from .prompt_builder import build_prompt
from .schemas import ChatMessage, Iteration, PMInput
from .self_model import PROMPTMASTER_SELF_MODEL
from .session_context import format_session_history


_PROMPTMASTER_CONTEXT = (
    "You are operating inside the PromptMaster Engine, a structured AI workflow "
    "system. The user is working through a defined objective in a specific mode. "
    "Stay aligned with the original objective at all times.\n\n"
    + PROMPTMASTER_SELF_MODEL
)


def _format_chat_thread(chat_history: list[ChatMessage]) -> str:
    if not chat_history:
        return "(no prior chat messages)"
    lines = []
    for m in chat_history:
        role = "User" if m.role == "user" else "Assistant"
        lines.append(f"{role}: {m.content}")
    return "\n".join(lines)


def _shared_system(inputs: PMInput, iterations: list[Iteration], extra: str) -> str:
    """Build the shared system prompt: PromptMaster context + mode + history + extra."""
    base = build_prompt(inputs)
    history = format_session_history(iterations)
    return (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"{base.system_prompt}\n\n"
        f"Session history:\n{history}\n\n"
        f"{extra}"
    )


# --------------------------------------------------------------------------
# 1. Chat reply — fluid, no eval, no iteration created
# --------------------------------------------------------------------------

_CHAT_REPLY_INSTRUCTION = (
    "CHAT MODE: The user is having a fluid conversation with you about a specific "
    "answer they generated. Reply naturally and helpfully, like a thoughtful "
    "collaborator. Do not produce a fully restructured 'next iteration' here — "
    "you are exploring ideas with the user. Stay grounded in the original "
    "objective; if the user asks something off-topic, gently steer back."
)


def build_chat_reply_prompt(
    inputs: PMInput,
    active_iteration: Iteration,
    chat_history: list[ChatMessage],
    user_message: str,
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompt for a fluid chat reply."""
    system = _shared_system(inputs, iterations, _CHAT_REPLY_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"CURRENT VERSION (#{active_iteration.iteration_number}):\n"
        f"{active_iteration.output}\n\n"
        f"CHAT SO FAR:\n{chat_block}\n\n"
        f"USER MESSAGE:\n{user_message}\n\n"
        "Reply to the user's message. Be conversational and concise."
    )
    return system, user_prompt


# --------------------------------------------------------------------------
# 2. Apply to answer — patch the active iteration's output
# --------------------------------------------------------------------------

_APPLY_INSTRUCTION = (
    "APPLY MODE: The user has had a chat about a specific answer and now wants "
    "you to revise that answer to incorporate the discussed insights, while "
    "preserving alignment with the original objective and constraints. Produce "
    "a complete updated version of the answer — full text, ready to read. Keep "
    "the structure and length appropriate to the objective."
)


def build_apply_to_answer_prompt(
    inputs: PMInput,
    active_iteration: Iteration,
    chat_history: list[ChatMessage],
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompt for Apply to Answer."""
    system = _shared_system(inputs, iterations, _APPLY_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"CURRENT VERSION (#{active_iteration.iteration_number}):\n"
        f"{active_iteration.output}\n\n"
        f"CHAT THREAD:\n{chat_block}\n\n"
        "Produce a revised version of the answer that incorporates the "
        "insights from the chat. Output only the revised answer text."
    )
    return system, user_prompt


# --------------------------------------------------------------------------
# 3. Save as new version — fresh generation using chat as additional context
# --------------------------------------------------------------------------

_SAVE_AS_NEW_INSTRUCTION = (
    "FRESH-GENERATION MODE: The user has had a chat about an existing answer and "
    "now wants a brand new version informed by that conversation. Treat the chat "
    "thread as additional constraints and guidance. Produce a fresh answer that "
    "fully addresses the original objective; do not simply copy the existing "
    "version's structure. Output only the new answer text."
)


def build_save_as_new_version_prompt(
    inputs: PMInput,
    active_iteration: Iteration,
    chat_history: list[ChatMessage],
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompt for Save as New Version."""
    system = _shared_system(inputs, iterations, _SAVE_AS_NEW_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"CHAT THREAD:\n{chat_block}\n\n"
        f"(Reference: previous version was #{active_iteration.iteration_number}.)\n\n"
        "Produce a fresh new version of the answer."
    )
    return system, user_prompt
