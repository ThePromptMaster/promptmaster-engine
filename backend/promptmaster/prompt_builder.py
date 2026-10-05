"""Prompt assembly for PromptMaster Engine.

Implements:
- Mode Locking (system prompt sets identity)
- Anchoring (goal anchors, role anchors, format anchors)
- Invisible Scaffolding (internal instructions)
"""

from .modes import MODES
from .schemas import PMInput, AssembledPrompt
from .project_context import context_block


def resolve_mode_config(inputs: PMInput) -> dict:
    """The mode's text for these inputs, with a custom persona's fields applied.

    Shared by `build_prompt` (the full mode lock) and the prose builders in
    `conversation.py`, which take only the mode's voice.
    """
    mode_config = dict(MODES[inputs.mode])

    # Inject custom mode fields when mode is 'custom'
    if inputs.mode == "custom" and (inputs.custom_name or inputs.custom_preamble or inputs.custom_tone):
        custom_name = inputs.custom_name or "Custom"
        custom_preamble = inputs.custom_preamble or mode_config["system_preamble"]
        custom_tone = inputs.custom_tone or mode_config["tone"]
        mode_config["display_name"] = custom_name
        mode_config["system_preamble"] = custom_preamble
        mode_config["tone"] = custom_tone
        mode_config["user_directive"] = f"Follow your role as {custom_name}. Stay in character."
        mode_config["scaffolding"] = (
            "[INTERNAL SCAFFOLDING]\n"
            f"- You are {custom_name}. Follow the persona precisely.\n"
            f"- Tone: {custom_tone}\n"
            "- DRIFT CHECK: Stay true to the custom persona throughout. Do not revert to a generic AI voice\n"
            "- ANCHOR: Re-read the objective before each section"
        )
    return mode_config


def build_prompt(inputs: PMInput) -> AssembledPrompt:
    """Assemble an optimized prompt from user inputs and selected mode.

    The assembled prompt has two layers (Prompt Stack concept from Ch5 S6):
    1. System prompt: mode lock + tone guidance + invisible scaffolding
    2. User prompt: objective + audience + constraints with anchoring
    """
    mode_config = resolve_mode_config(inputs)

    # System prompt: mode lock + scaffolding
    system_prompt = (
        f"{mode_config['system_preamble']}\n\n"
        f"TONE GUIDANCE: {mode_config['tone']}\n\n"
        f"{mode_config['scaffolding']}"
    )

    # User prompt: natural language with embedded anchoring
    # Book principle (Ch5 S9 / Ch8): weave context into flowing text, not label-heavy form dumps.
    parts = [inputs.objective]

    # Session Facts / Information Anchors (Ch5 S5) — pin agreed facts so the AI
    # can't contradict them. Injected as a bulleted "established facts" block.
    facts = [f for f in (inputs.session_facts or []) if f.strip()]
    if facts:
        facts_block = "ESTABLISHED FACTS (anchor on these — do not contradict):\n" + "\n".join(
            f"- {fact}" for fact in facts
        )
        parts.append(facts_block)

    # The project's source material (4 Oct), kept apart from the objective.
    if (inputs.context or "").strip():
        parts.append(context_block(inputs))

    context_pieces = []
    if inputs.audience:
        context_pieces.append(f"Audience: {inputs.audience}")
    if inputs.constraints.strip():
        context_pieces.append(f"Constraints: {inputs.constraints}")
    if inputs.output_format.strip():
        context_pieces.append(f"Format: {inputs.output_format}")
    if context_pieces:
        parts.append(". ".join(context_pieces) + ".")

    parts.append(mode_config["user_directive"])

    user_prompt = "\n\n".join(parts)

    return AssembledPrompt(
        system_prompt=system_prompt,
        user_prompt=user_prompt.strip(),
        scaffolding_notes=mode_config["scaffolding"],
    )
