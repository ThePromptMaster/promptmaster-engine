"""Flow Triggers — one-click advanced prompting techniques from the book.

Implements book concepts from Ch1 S13-S14 and Ch2 S15:
- Contradiction Prompts (Challenge This)
- Structured Self-Check (Self-Audit Response)
- Call Out Drift Directly (Drift Alert)
- Refinement Loops (Refine as... variants)
- Shadow Prompts (Check Intent)
- Reverse Q&A (Ask Questions)

Each trigger either:
  (a) builds a new prompt that runs through the full iteration pipeline
      (generate + eval + suggest), or
  (b) runs a lightweight one-shot inspection call that returns text.
"""

import json
import logging
from typing import Literal

from .critique_style import critique_style_block
from .schemas import PMInput, EvaluationResult, Iteration
from .llm_client import OpenRouterClient
from .modes import MODES
from .prompt_builder import build_prompt
from .self_model import PROMPTMASTER_SELF_MODEL
from .session_context import format_session_history

logger = logging.getLogger(__name__)

FlowTriggerType = Literal[
    "challenge",
    "self_audit",
    "reframe",
    "drift_alert",
    "refine_shorter",
    "refine_technical",
    "refine_concrete",
    "refine_angle",
    "refine_cautious",
]

FlowInspectType = Literal[
    "check_intent",
    "confirm_understanding",
    "analyze_pattern",
    "ask_questions",
]


# ============================================================================
# ITERATION-BASED TRIGGERS
# Build (system_prompt, user_prompt) that go through full generate+eval+suggest
# ============================================================================

_PROMPTMASTER_CONTEXT = (
    "You are operating inside PromptMaster — a structured AI workflow system based on the book "
    "'How to Become a PromptMaster' by Sean Moran. The user works through the stages of a "
    "workflow toward a stated objective. "
    "The system uses Mode Locking, Anchoring, and Invisible Scaffolding to keep the AI aligned, "
    "and a separate evaluator LLM to detect drift.\n\n"
    + PROMPTMASTER_SELF_MODEL
    + "\n\n"
    "USER RATINGS: The session history may show iterations rated STRONG or POOR by the user. "
    "These are direct signals about their taste. When producing new output or critique, actively "
    "preserve what made STRONG iterations work and avoid repeating the patterns of POOR ones."
)


def build_challenge_prompt(
    inputs: PMInput, current_output: str, iterations: list[Iteration] | None = None
) -> tuple[str, str]:
    """Contradiction Prompt (Ch1 S14) — argue the opposite, stress-test the output."""
    mode_config = MODES[inputs.mode]
    system = (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"You are operating in PromptMaster Challenge Mode, building on {mode_config['display_name']} Mode.\n\n"
        "You just produced an answer that addressed the user's objective. Your new task is to "
        "argue AGAINST that previous answer — identify its flaws, hidden assumptions, weak reasoning, "
        "and missing perspectives. This is rigorous stress-testing (Ch1 S14 Contradiction Prompts), "
        "not contrarianism for its own sake. The goal is to surface what is fragile in the previous "
        "answer so the user can see it clearly.\n\n"
        "Do not produce a new polished answer. Produce a structured critique of the previous answer. "
        "Reference specific parts of it. Be specific.\n\n"
        + critique_style_block(inputs.critique_intensity, inputs.critique_tone)
    )
    user = (
        f"Original objective: {inputs.objective}\n\n"
        f"{format_session_history(iterations or [])}\n\n"
        f"--- PREVIOUS ANSWER (the one you are challenging) ---\n{current_output}\n--- END PREVIOUS ANSWER ---\n\n"
        "Now challenge this answer. Structure your response as:\n"
        "1. **Unstated assumptions** — what does the answer quietly assume?\n"
        "2. **Weak reasoning** — where does the logic fail to hold up?\n"
        "3. **Missing perspectives** — what important angles were ignored?\n"
        "4. **Opposite view** — what would a well-reasoned argument against this answer look like?\n"
        "Be specific. Reference exact claims or sentences from the previous answer."
    )
    return system, user


def build_reframe_prompt(
    inputs: PMInput, current_output: str, iterations: list[Iteration] | None = None
) -> tuple[str, str]:
    """Commanding the Frame (Ch4 S10) — Tier 4 reframing meta-move.

    Instead of micro-optimizing the current answer, question whether the
    problem is framed correctly in the first place.
    """
    mode_config = MODES[inputs.mode]
    system = (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"You are operating in PromptMaster Reframe Mode, a Tier 4 meta-move (Ch4 S10 "
        f"'Commanding the Frame'). You are building on {mode_config['display_name']} Mode.\n\n"
        "You just produced an answer that addressed the user's stated objective. Lower tiers "
        "refine the answer; Tier 4 reframes the PROBLEM. Your task now is to step back one level "
        "and ask: is the user solving the right problem? Is there a higher-level framing that "
        "would make the current question obsolete?\n\n"
        "Do not produce a refined answer. Produce a structured reframing analysis.\n\n"
        + critique_style_block(inputs.critique_intensity, inputs.critique_tone)
    )
    user = (
        f"Original objective: {inputs.objective}\n\n"
        f"{format_session_history(iterations or [])}\n\n"
        f"--- CURRENT ANSWER (working within the existing frame) ---\n{current_output}\n--- END CURRENT ANSWER ---\n\n"
        "Now reframe. Structure your response as:\n\n"
        "**1. Frame Critique** — Is the current question framed correctly? What does this framing "
        "quietly assume? What does it exclude?\n\n"
        "**2. Alternative Framings** — List 2-3 meaningfully different ways the user could frame "
        "this problem. For each, state what it would change about the answer.\n\n"
        "**3. The Reframe** — Propose ONE specific reframe that would make the current answer "
        "obsolete in a good way. State the new framing as a one-sentence question or directive.\n\n"
        "**4. What to Do Next** — Tell the user exactly how to apply this reframe: give the new "
        "objective as one sentence they could adopt, and what it would change in the work. Do not "
        "name buttons or screens.\n\n"
        "Be specific, not abstract. Reference the actual content of the current answer."
    )
    return system, user


def build_self_audit_response_prompt(
    inputs: PMInput, current_output: str, iterations: list[Iteration] | None = None
) -> tuple[str, str]:
    """Structured Self-Check (Ch1 S13) — AI audits its own last response and fixes gaps."""
    mode_config = MODES[inputs.mode]
    system = (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"You are operating in PromptMaster Self-Audit Mode, building on {mode_config['display_name']} Mode.\n\n"
        "You just produced an answer. Your new task is to audit your own response (Ch1 S13 Structured "
        "Self-Check): identify specific ways it may be incomplete, unclear, or fail to fully address "
        "the user's objective. Then produce a revised answer that fixes those specific gaps.\n\n"
        "Don't say vague things like 'could be more detailed.' Name the specific gap and "
        "show how your revision closes it.\n\n"
        + critique_style_block(inputs.critique_intensity, inputs.critique_tone)
    )
    user = (
        f"Original objective: {inputs.objective}\n\n"
        f"{format_session_history(iterations or [])}\n\n"
        f"--- PREVIOUS ANSWER (the one you are auditing) ---\n{current_output}\n--- END PREVIOUS ANSWER ---\n\n"
        "Structure your response in two parts:\n\n"
        "**Part 1 — Gap Analysis**: List 3-5 specific ways the previous answer falls short. "
        "For each, state what is missing or unclear and why it matters for the objective.\n\n"
        "**Part 2 — Revised Answer**: Produce a new, improved answer that directly addresses each gap you named. "
        "Keep the structure and scope aligned with the original objective."
    )
    return system, user


def build_drift_alert_prompt(
    inputs: PMInput,
    current_output: str,
    evaluation: EvaluationResult | None,
    iterations: list[Iteration] | None = None,
) -> tuple[str, str]:
    """Call Out Drift Directly (Ch2 S15) — explicit drift correction.

    Reuses build_prompt() to get the correct mode-locked system prompt,
    including custom mode's custom_preamble and custom_tone.
    """
    mode_display = (
        inputs.custom_name or "Custom"
        if inputs.mode == "custom"
        else MODES[inputs.mode]["display_name"]
    )
    drift_reason = (
        evaluation.drift.explanation
        if evaluation and evaluation.drift.score != "Low"
        else "The previous answer wandered off the core objective."
    )

    base = build_prompt(inputs)
    system = (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"{base.system_prompt}\n\n"
        "DRIFT ALERT (Ch2 S15 Call Out Drift Directly): The previous answer drifted from the user's "
        "objective. You are being called back to the anchor. Re-read the objective carefully. "
        "Produce a new answer that stays tightly within scope. Do not repeat the drift patterns that were flagged."
    )
    user = (
        "STOP. The previous answer drifted from the objective.\n\n"
        f"Drift detected: {drift_reason}\n\n"
        f"{format_session_history(iterations or [])}\n\n"
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
    )
    if inputs.constraints.strip():
        user += f"Constraints: {inputs.constraints}\n"
    if inputs.output_format.strip():
        user += f"Format: {inputs.output_format}\n"
    user += (
        f"\nRe-answer the objective now. Stay strictly within scope. Do not repeat the drift patterns above. "
        f"Operate as {mode_display} Mode throughout."
    )
    return system, user


REFINE_CONSTRAINTS = {
    "refine_shorter": "Condense the previous answer to roughly half its length while preserving all key points. Cut filler and redundancy ruthlessly.",
    "refine_technical": "Rewrite the previous answer with deeper technical depth, domain terminology, and implementation-level specifics. Assume the reader has expertise.",
    "refine_concrete": "Rewrite the previous answer with specific examples, concrete cases, and real-world references. Remove abstract generalities.",
    "refine_angle": "Reanalyze the objective from a completely different angle than the previous answer. Do not repeat the same framing or structure.",
    "refine_cautious": "Rewrite the previous answer with explicit caveats, uncertainties, and risk callouts where appropriate. Flag what is unknown or contested.",
}


def build_refine_prompt(
    inputs: PMInput,
    current_output: str,
    trigger: FlowTriggerType,
    iterations: list[Iteration] | None = None,
) -> tuple[str, str]:
    """Refinement Loops (Ch1 S14) — iterate with a specific single constraint."""
    mode_config = MODES[inputs.mode]
    refine_instruction = REFINE_CONSTRAINTS[trigger]

    base_system = build_prompt(inputs).system_prompt
    system = (
        f"{_PROMPTMASTER_CONTEXT}\n\n"
        f"{base_system}\n\n"
        "You are in a Refinement Loop (Ch1 S14). Apply the single refinement constraint "
        "exactly — do not make unrelated changes."
    )
    user = (
        f"Original objective: {inputs.objective}\n\n"
        f"{format_session_history(iterations or [])}\n\n"
        f"--- PREVIOUS ANSWER (the one you are refining) ---\n{current_output}\n--- END PREVIOUS ANSWER ---\n\n"
        f"REFINEMENT INSTRUCTION: {refine_instruction}\n\n"
        f"Produce the refined version now, staying within {mode_config['display_name']} Mode. "
        "Return only the refined text itself — no preamble, no notes on what changed, "
        "and no appended 'Next Steps' section."
    )
    return system, user


def build_flow_trigger_prompt(
    inputs: PMInput,
    current_output: str,
    trigger: FlowTriggerType,
    evaluation: EvaluationResult | None = None,
    iterations: list[Iteration] | None = None,
) -> tuple[str, str]:
    """Dispatch to the correct prompt builder for the trigger type."""
    if trigger == "challenge":
        return build_challenge_prompt(inputs, current_output, iterations)
    if trigger == "self_audit":
        return build_self_audit_response_prompt(inputs, current_output, iterations)
    if trigger == "reframe":
        return build_reframe_prompt(inputs, current_output, iterations)
    if trigger == "drift_alert":
        return build_drift_alert_prompt(inputs, current_output, evaluation, iterations)
    if trigger in REFINE_CONSTRAINTS:
        return build_refine_prompt(inputs, current_output, trigger, iterations)
    raise ValueError(f"Unknown flow trigger type: {trigger}")


# ============================================================================
# INSPECTION-ONLY TRIGGERS (one-shot calls, no iteration)
# ============================================================================

CHECK_INTENT_SYSTEM = (
    f"{_PROMPTMASTER_CONTEXT}\n\n"
    "You are the goal inference layer (Ch1 S14 Shadow Prompts). Your job is to look at a user's "
    "prompting session and infer what they REALLY want underneath. Read between the lines. "
    "Identify the underlying goal, not just the literal request. Be insightful and specific. "
    "Avoid generic observations."
)

CHECK_INTENT_PROMPT = """A user is working through a PromptMaster session:

Objective (stated): {objective}
Audience: {audience}
Mode: {mode}
Constraints: {constraints}

{session_history}

The AI just produced this output (the most recent one):
---
{current_output}
---

Now answer two questions:

**1. Inferred Goal** — In 2-3 sentences, what does the user REALLY want at the underlying level? Read between the lines. Consider how the session has evolved across iterations.

**2. Implicit Expectations** — List 2-3 specific things the user might be implicitly expecting that they did NOT state explicitly. These are things that could cause friction if the output misses them.

Be specific and insightful. Avoid generic commentary."""


CONFIRM_UNDERSTANDING_SYSTEM = (
    f"{_PROMPTMASTER_CONTEXT}\n\n"
    "You are the understanding confirmation layer (Ch6 S3.1 'The Clarifying Prompt'). "
    "The user wants to verify that you heard their request correctly. Restate their goal "
    "and approach in your OWN words — not fancy, just clear. If you catch any ambiguity "
    "in what they asked, flag it so they can correct you. This is NOT about inferring hidden "
    "meaning (that's Check Intent). This is about playing back what they literally asked, "
    "so mismatches surface early."
)

CONFIRM_UNDERSTANDING_PROMPT = """A user is working through a PromptMaster session:

Objective (stated): {objective}
Audience: {audience}
Mode: {mode}
Constraints: {constraints}
Format: {output_format}

{session_history}

The AI just produced this output:
---
{current_output}
---

Now do two things:

**1. Restated Goal** — In 2-3 plain sentences, restate what you understand the user is trying to accomplish. Use your own words. Do NOT infer hidden goals — just play back what they asked.

**2. Ambiguities Found** — List any ambiguities in the request that caused you to guess. If there were none, say so. If there were some, be specific about what you assumed and what they should clarify.

Keep it concrete. Do not add philosophical commentary."""


ANALYZE_PATTERN_SYSTEM = (
    f"{_PROMPTMASTER_CONTEXT}\n\n"
    "You are the pattern analysis layer (Ch6 S3.3 'Mode Switch for Reflection'). "
    "The user wants you to step back and observe HOW they have been prompting — not "
    "what they asked, but the patterns in their style, structure, and decisions. "
    "This is observational, not adversarial (Cold Critic is adversarial). "
    "Identify 3-4 specific patterns you see in how they've been directing the session. "
    "Some can be strengths, some can be gaps. Be specific and non-judgmental."
)

ANALYZE_PATTERN_PROMPT = """A user has been working through this PromptMaster session:

Objective: {objective}
Audience: {audience}
Mode: {mode}
Constraints: {constraints}

{session_history}

The latest output:
---
{current_output}
---

Now step back and observe the user's prompting patterns. Structure your response as:

**Patterns Observed** — List 3-4 specific patterns in how the user has been directing this session. Examples might be: "You tend to set specific constraints upfront but rarely revise them mid-session" or "You iterate toward concrete examples rather than structural outlines" or "You haven't changed modes even though the objective shifted." Be observational, not judgmental.

**One Actionable Insight** — Pick ONE pattern that, if adjusted, would most improve their session. State it as a specific behavioral change they could try next iteration.

Be specific. Reference actual iterations in the history when making points."""


ASK_QUESTIONS_SYSTEM = (
    f"{_PROMPTMASTER_CONTEXT}\n\n"
    "You are the clarification layer (Ch1 S14 Reverse Q&A). Based on a user's objective, session "
    "history, and the current AI output, identify gaps or ambiguities that are preventing the best "
    "possible answer. Ask 2-3 specific, targeted questions that would unlock a sharper response. "
    "Questions must be concrete, not vague. Return ONLY a JSON array of question strings."
)

ASK_QUESTIONS_PROMPT = """Objective: {objective}
Audience: {audience}
Mode: {mode}
Constraints: {constraints}

{session_history}

Current output (the most recent one):
---
{current_output}
---

Identify 2-3 specific ambiguities or missing context that, if clarified, would lead to a notably better answer. Generate questions that target those gaps. Each question should be concrete and answerable.

Return as a JSON array of question strings, nothing else. Example format:
["Question 1?", "Question 2?", "Question 3?"]"""


async def run_check_intent(
    client: OpenRouterClient,
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> str:
    """Shadow Prompt (Ch1 S14) — infer the user's real goal from the session."""
    prompt = CHECK_INTENT_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        mode=MODES[inputs.mode]["display_name"],
        constraints=inputs.constraints or "(none)",
        current_output=current_output[:1500],
        session_history=format_session_history(iterations or []),
    )
    content, _usage = await client.generate(
        prompt=prompt,
        system=CHECK_INTENT_SYSTEM,
        temperature=0.3,
        max_tokens=512,
        model=model,
    )
    return content.strip()


async def run_confirm_understanding(
    client: OpenRouterClient,
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> str:
    """Clarifying Prompt (Ch6 S3.1) — AI restates user's goal in its own words."""
    prompt = CONFIRM_UNDERSTANDING_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        mode=MODES[inputs.mode]["display_name"],
        constraints=inputs.constraints or "(none)",
        output_format=inputs.output_format or "(not specified)",
        current_output=current_output[:1500],
        session_history=format_session_history(iterations or []),
    )
    content, _usage = await client.generate(
        prompt=prompt,
        system=CONFIRM_UNDERSTANDING_SYSTEM,
        temperature=0.2,
        max_tokens=512,
        model=model,
    )
    return content.strip()


async def run_analyze_pattern(
    client: OpenRouterClient,
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> str:
    """Mode Switch for Reflection (Ch6 S3.3) — AI observes user's prompting patterns."""
    prompt = ANALYZE_PATTERN_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        mode=MODES[inputs.mode]["display_name"],
        constraints=inputs.constraints or "(none)",
        current_output=current_output[:1500],
        session_history=format_session_history(iterations or []),
    )
    content, _usage = await client.generate(
        prompt=prompt,
        system=ANALYZE_PATTERN_SYSTEM,
        temperature=0.3,
        max_tokens=640,
        model=model,
    )
    return content.strip()


async def run_ask_questions(
    client: OpenRouterClient,
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> list[str]:
    """Reverse Q&A (Ch1 S14) — AI asks the user clarifying questions to unblock progress."""
    prompt = ASK_QUESTIONS_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        mode=MODES[inputs.mode]["display_name"],
        constraints=inputs.constraints or "(none)",
        current_output=current_output[:1500],
        session_history=format_session_history(iterations or []),
    )
    try:
        result, _usage = await client.generate_json(
            prompt=prompt,
            system=ASK_QUESTIONS_SYSTEM,
            temperature=0.3,
            max_tokens=512,
            model=model,
        )
        if isinstance(result, list):
            return [str(q) for q in result[:3]]
        if isinstance(result, dict):
            for key in ("questions", "items"):
                if key in result and isinstance(result[key], list):
                    return [str(q) for q in result[key][:3]]
            for value in result.values():
                if isinstance(value, list) and len(value) > 0:
                    return [str(q) for q in value[:3]]
        logger.warning(f"Unexpected ask_questions format: {type(result)}")
        return []
    except Exception as e:
        logger.warning(f"Ask questions failed: {e}")
        return []
