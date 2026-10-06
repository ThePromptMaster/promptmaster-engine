"""Prompt builders for the chat / apply / save-as-new-version flows.

Three flows share a common scaffolding (objective, audience, constraints,
session history with rating signals) and differ only in the system-prompt
instruction and what they put in the user message.
"""

from __future__ import annotations

from .page_context import ChatContext, format_chat_context
from .prompt_builder import build_prompt, resolve_mode_config
from .schemas import ChatMessage, Iteration, PMInput
from .self_model import PROMPTMASTER_SELF_MODEL
from .session_context import format_session_history
from .project_context import context_line


_PROMPTMASTER_CONTEXT = (
    "You are operating inside the PromptMaster Engine, a structured AI workflow "
    "system. The user is working through a defined objective in a specific mode. "
    "Stay aligned with the original objective at all times.\n\n"
    + PROMPTMASTER_SELF_MODEL
)


def _where(context: ChatContext | None) -> str:
    """The stage/workflow/manuscript block, followed by a blank line; '' when absent."""
    block = format_chat_context(context)
    return f"{block}\n\n" if block else ""


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


def _prose_system(inputs: PMInput, extra: str) -> str:
    """The system prompt for finished prose: the mode as a voice, never as a scaffold.

    Architect mode's lock says "You do not write final prose — you build
    scaffolding", and its scaffolding asks for headings, submodules and
    numbered sub-plans. Through `_shared_system` that text reached every
    chapter prompt beside "Do NOT outline", and the chapters came out as
    outlines ("it really wants to make outlines", the client, 2 Oct). Here the
    mode contributes its name and tone, and a custom persona its preamble;
    the structural instructions stay out.
    """
    mode = resolve_mode_config(inputs)
    voice = [f"MODE: {mode['display_name']}.", f"TONE GUIDANCE: {mode['tone']}"]
    if inputs.mode == "custom":
        voice.insert(1, mode["system_preamble"])
    return (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        + "\n".join(voice)
        + "\n\nThe mode shapes voice and emphasis only. What you write here is finished "
        "prose for a reader, so a mode's structural habits — scaffolds, headings, "
        "numbered sub-plans, tables in place of narrative — do not apply.\n\n"
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
    "objective; if the user asks something off-topic, gently steer back. "
    "When you point the user to a next step, name a button only if it is listed "
    "under BUTTONS ON THIS PAGE NOW, in exactly those words; otherwise name the "
    "stage where it happens."
)


def build_chat_reply_prompt(
    inputs: PMInput,
    active_iteration: Iteration,
    chat_history: list[ChatMessage],
    user_message: str,
    iterations: list[Iteration],
    context: ChatContext | None = None,
) -> tuple[str, str]:
    """Build (system, user) prompt for a fluid chat reply."""
    system = _shared_system(inputs, iterations, _CHAT_REPLY_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"{context_line(inputs)}"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"{_where(context)}"
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
    context: ChatContext | None = None,
) -> tuple[str, str]:
    """Build (system, user) prompt for Apply to Answer."""
    system = _shared_system(inputs, iterations, _APPLY_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"{context_line(inputs)}"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"{_where(context)}"
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

# The current text used to be withheld here ("previous version was #n" and no
# more), so the new version was rewritten from the brief and the thread alone
# and lost whatever the chat never mentioned. It now revises what is there.
_SAVE_AS_NEW_INSTRUCTION = (
    "NEW-VERSION MODE: The user has had a chat about the current version and now "
    "wants a new version that takes that conversation into account. Treat what "
    "the chat settled as instructions. Start from the current version, change "
    "what the chat asked for, and keep the rest. Output only the full text of "
    "the new version, ready to read."
)


def build_save_as_new_version_prompt(
    inputs: PMInput,
    active_iteration: Iteration,
    chat_history: list[ChatMessage],
    iterations: list[Iteration],
    context: ChatContext | None = None,
) -> tuple[str, str]:
    """Build (system, user) prompt for Save as New Version."""
    system = _shared_system(inputs, iterations, _SAVE_AS_NEW_INSTRUCTION)
    chat_block = _format_chat_thread(chat_history)
    user_prompt = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"{context_line(inputs)}"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        f"{_where(context)}"
        f"CURRENT VERSION (#{active_iteration.iteration_number}):\n"
        f"{active_iteration.output}\n\n"
        f"CHAT THREAD:\n{chat_block}\n\n"
        "Produce the new version: the current version with everything the chat "
        "settled applied, and everything the chat did not touch kept."
    )
    return system, user_prompt
