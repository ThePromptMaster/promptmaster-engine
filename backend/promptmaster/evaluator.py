"""Evaluation layer for PromptMaster Engine.

Makes a SEPARATE LLM call (distinct from generation) to evaluate the output
along three dimensions: Alignment, Drift, Clarity.

Returns qualitative scores (Low/Medium/High) with one-sentence explanations.
"""

import logging
from .schemas import PMInput, EvaluationResult, DimensionScore, Iteration, CompletenessResult, WhyThisWorks
from .llm_client import OpenRouterClient
from .session_context import format_session_history

logger = logging.getLogger(__name__)

EVALUATOR_SYSTEM = (
    "You are the evaluation layer of PromptMaster — a structured AI workflow system "
    "based on the book 'How to Become a PromptMaster.' Your role is critical to the "
    "system's iterative improvement loop: generate → evaluate → correct → improve.\n\n"
    "You assess AI-generated content against the user's original objective using three "
    "dimensions. You understand the PromptMaster methodology:\n"
    "- MODE LOCKING (Ch5 S3): The AI was given a specific persona via system prompt. "
    "Evaluate whether the output stays in character for that mode.\n"
    "- ANCHORING (Ch5 S5): The prompt includes goal anchors, role anchors, and format "
    "anchors. Evaluate whether the output honors these anchors.\n"
    "- INVISIBLE SCAFFOLDING (Ch5 S7): Behind-the-scenes instructions guide the AI's "
    "behavior. Drift means the output escaped that scaffolding.\n"
    "- DRIFT (Ch5 S10): Scope deviation from the objective — covering topics not asked "
    "for, losing the mode's tone, becoming generic, padding with filler, or fixating on "
    "tangents. Drift is the primary failure mode in extended AI interactions.\n\n"
    "USER RATINGS: If the session history shows iterations rated STRONG or POOR by the user, "
    "use them as calibration for what the user considers quality. A new output that echoes "
    "patterns from STRONG iterations should score higher; one that echoes patterns from "
    "POOR iterations should score lower. The user's taste is a direct input to your scoring.\n\n"
    "You are fair but rigorous. You do not inflate scores, but you give credit where "
    "earned. Return ONLY valid JSON, no other text."
)

EVALUATOR_PROMPT = """Evaluate the following AI-generated output against the original request.

ORIGINAL OBJECTIVE: {objective}
TARGET AUDIENCE: {audience}
CONSTRAINTS: {constraints}
REQUESTED FORMAT: {output_format}
MODE USED: {mode}

{session_history}

--- BEGIN CURRENT OUTPUT (the one you are evaluating) ---
{output}
--- END CURRENT OUTPUT ---

Evaluate along five dimensions. For the first three, assign "Low", "Medium", or "High" and provide exactly one sentence of explanation.

SCORING GUIDELINES (be consistent — do not change a score unless the output genuinely changed):
- "High" = strong, well-targeted output that clearly meets the bar. Award it confidently when earned. If the output addresses the objective, is well-structured, and stays on scope, it deserves "High."
- "Medium" = acceptable but with clear, specific room for improvement. You MUST name what is lacking.
- "Low" = significant problems — misses the objective, drifts off-topic, or is poorly structured.

IMPORTANT: Do not penalize stylistic variation. Focus on substance, not style.

1. ALIGNMENT: Does the output directly address the stated objective for the target audience?
   - Consider: Does it answer what was asked? Is it substantive enough? Does it match the audience's needs?
   - "High" = on-target and substantive. "Medium" = addresses the topic but misses key aspects. "Low" = misses the objective or is too vague/broad.

2. DRIFT: Did the output escape the PromptMaster scaffolding? Drift is the primary failure mode in AI interactions.
   - Signs of drift: covering topics NOT asked for, breaking character from the selected mode ({mode}), becoming generic when specificity was needed, padding with filler, fixating on tangents, or losing the mode's required tone.
   - "Low" = focused and stays within scope (this is GOOD). "Medium" = mostly focused but includes unnecessary content. "High" = significant scope deviation or off-topic material.

3. CLARITY: Is the output well-structured, unambiguous, and complete?
   - Consider the mode's expected output style: {mode} mode has specific structural expectations.
   - "High" = clear, well-organized, easy to follow. "Medium" = understandable but could be tighter. "Low" = confusing, vague, or incomplete.

4. COMPLETENESS: Does the output appear structurally complete given the objective?
   - "complete" = the answer covers what the objective required, with appropriate depth across all expected sections/topics. The output reads as a finished response.
   - "incomplete" = the answer stops mid-section, runs out of room, covers only some expected sections, skips depth on later sections, or leaves obvious gaps. If the user asked for a 15-section BRD and only 5 sections appear, mark INCOMPLETE.
   - If INCOMPLETE, name in one short sentence WHERE it stops or what's missing.

5. INTERPRETATION: In 3-4 short bullets, plain English (no technical jargon), explain why this output succeeds OR what to improve.
   - Use the label "Why this works" when the output is strong overall (alignment High, drift Low, clarity High).
   - Use the label "What to improve" when there's a clear weakness in any dimension.
   - bullets[0]: one short sentence (≤10 words) about the goal/alignment.
   - bullets[1]: one short sentence about structure/clarity.
   - bullets[2]: one short sentence about focus/drift.
   - bullets[3] (optional): one short sentence about completeness or another standout property.
   - Each bullet should be self-contained — readable without the others.

Return JSON in exactly this format:
{{
    "alignment": {{"score": "Low|Medium|High", "explanation": "one sentence"}},
    "drift": {{"score": "Low|Medium|High", "explanation": "one sentence"}},
    "clarity": {{"score": "Low|Medium|High", "explanation": "one sentence"}},
    "completeness": {{"status": "complete|incomplete", "reason": "one short sentence (empty string if complete)"}},
    "interpretation": {{
        "label": "Why this works|What to improve",
        "bullets": ["...", "...", "..."]
    }}
}}"""


async def evaluate_output(
    client: OpenRouterClient,
    inputs: PMInput,
    output: str,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> EvaluationResult:
    """Run evaluation as a separate LLM call.

    Args:
        client: OpenRouterClient instance (reused from generation)
        inputs: Original user inputs
        output: The generated output to evaluate
        iterations: Prior iterations in this session (for context)
        model: Optional model override

    Returns:
        EvaluationResult with alignment, drift, clarity scores
    """
    prompt = EVALUATOR_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        constraints=inputs.constraints or "(none)",
        output_format=inputs.output_format or "(not specified)",
        mode=inputs.mode,
        output=output,
        session_history=format_session_history(iterations or []),
    )

    try:
        result_dict, _usage = await client.generate_json(
            prompt=prompt,
            system=EVALUATOR_SYSTEM,
            temperature=0.15,
            max_tokens=768,
            model=model,
        )

        # Parse completeness defensively
        completeness: CompletenessResult | None = None
        comp_raw = result_dict.get("completeness")
        if isinstance(comp_raw, dict):
            try:
                completeness = CompletenessResult(**comp_raw)
            except Exception as comp_err:
                logger.warning(f"Invalid completeness in eval response, dropping: {comp_err}")

        # Parse interpretation defensively
        interpretation: WhyThisWorks | None = None
        interp_raw = result_dict.get("interpretation")
        if isinstance(interp_raw, dict):
            try:
                interpretation = WhyThisWorks(**interp_raw)
            except Exception as interp_err:
                logger.warning(f"Invalid interpretation in eval response, dropping: {interp_err}")

        return EvaluationResult(
            alignment=DimensionScore(**result_dict.get("alignment", {"score": "Medium", "explanation": "Unable to evaluate"})),
            drift=DimensionScore(**result_dict.get("drift", {"score": "Medium", "explanation": "Unable to evaluate"})),
            clarity=DimensionScore(**result_dict.get("clarity", {"score": "Medium", "explanation": "Unable to evaluate"})),
            completeness=completeness,
            interpretation=interpretation,
        )
    except Exception as e:
        logger.error(f"Evaluation failed: {e}")
        return EvaluationResult(
            alignment=DimensionScore(score="Medium", explanation=f"Evaluation error: {e}"),
            drift=DimensionScore(score="Medium", explanation=f"Evaluation error: {e}"),
            clarity=DimensionScore(score="Medium", explanation=f"Evaluation error: {e}"),
            completeness=None,
            interpretation=None,
            failed=True,
            failure="This version could not be scored. Nothing was lost; run the check again.",
        )
