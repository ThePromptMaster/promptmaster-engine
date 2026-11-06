"""Core orchestrator for PromptMaster Engine.

Coordinates: prompt building -> LLM execution -> evaluation -> realignment.
All state is managed by the caller (Streamlit session_state).
"""

from .llm_client import OpenRouterClient
from .schemas import PMInput, Iteration, EvaluationResult, AssembledPrompt, Session
from .prompt_builder import build_prompt
from .evaluator import evaluate_output
from .realigner import build_realignment_prompt


async def generate(
    client: OpenRouterClient,
    prompt_text: str,
    system_text: str,
    model: str | None = None,
    images: list[str] | None = None,
) -> str:
    """Execute a single generation call. Returns the output text."""
    content, _usage = await client.generate(
        prompt=prompt_text,
        system=system_text,
        temperature=0.7,
        max_tokens=4096,
        model=model,
        **({"images": images} if images else {}),
    )
    return content


async def run_iteration(
    client: OpenRouterClient,
    inputs: PMInput,
    prompt_text: str,
    system_text: str,
    iteration_number: int,
    model: str | None = None,
) -> Iteration:
    """Run one complete generate-then-evaluate cycle.

    Returns an Iteration with the output and evaluation attached.
    """
    # Generate
    output = await generate(client, prompt_text, system_text, model=model)

    # Evaluate (separate LLM call)
    evaluation = await evaluate_output(client, inputs, output, model=model)

    return Iteration(
        iteration_number=iteration_number,
        prompt_sent=prompt_text,
        system_prompt_used=system_text,
        output=output,
        mode=inputs.mode,
        evaluation=evaluation,
    )


def format_session_summary(inputs: PMInput, iterations: list[Iteration]) -> str:
    """Generate the copyable session summary text."""
    if not iterations:
        return "No iterations completed."

    final = iterations[-1]
    eval_text = "Not evaluated"
    if final.evaluation:
        e = final.evaluation
        eval_text = (
            f"  Alignment: {e.alignment.score} — {e.alignment.explanation}\n"
            f"  Drift:     {e.drift.score} — {e.drift.explanation}\n"
            f"  Clarity:   {e.clarity.score} — {e.clarity.explanation}"
        )

    parts = [
        "=" * 60,
        "PROMPTMASTER SESSION SUMMARY",
        "=" * 60,
        "",
        f"Objective:   {inputs.objective}",
        f"Audience:    {inputs.audience}",
        f"Constraints: {inputs.constraints or '(none)'}",
        f"Format:      {inputs.output_format or '(none)'}",
        f"Mode:        {inputs.mode.title()}",
        f"Iterations:  {len(iterations)}",
        "",
        "--- FINAL SCORES ---",
        eval_text,
        "",
        "--- FINAL PROMPT ---",
        final.prompt_sent,
        "",
        "--- FINAL OUTPUT ---",
        final.output,
        "",
        "=" * 60,
    ]
    return "\n".join(parts)


HARD_RESET_SYSTEM = (
    "You are a concise session summarizer. Extract the key lessons learned from "
    "a PromptMaster session. Focus on what worked, what didn't, and what the user "
    "should carry forward into their next session. Output only bullet points, no preamble."
)

HARD_RESET_PROMPT = """Summarize the key lessons from this session in 3-5 bullet points.

OBJECTIVE: {objective}
MODE: {mode}
ITERATIONS: {iteration_count}

{iteration_details}

Extract:
- What worked well (keep doing this)
- What didn't work (avoid next time)
- Key insights about the objective discovered during iteration
- Specific constraints or refinements to carry forward

Output only concise bullet points. No intro, no conclusion."""


async def generate_hard_reset_lessons(
    client: OpenRouterClient,
    inputs: PMInput,
    iterations: list[Iteration],
    model: str | None = None,
) -> str:
    """Summarize lessons before a hard reset (Ch5 S13 concept)."""
    iteration_details = []
    for it in iterations:
        detail = f"Iteration {it.iteration_number} (Mode: {it.mode}): "
        if it.evaluation:
            e = it.evaluation
            detail += f"Alignment={e.alignment.score}, Drift={e.drift.score}, Clarity={e.clarity.score}"
        iteration_details.append(detail)

    prompt = HARD_RESET_PROMPT.format(
        objective=inputs.objective,
        mode=inputs.mode,
        iteration_count=len(iterations),
        iteration_details="\n".join(iteration_details),
    )

    content, _usage = await client.generate(
        prompt=prompt,
        system=HARD_RESET_SYSTEM,
        temperature=0.3,
        max_tokens=512,
        model=model,
    )
    return content


SELF_AUDIT_SYSTEM = (
    "You are in Cold Critic Mode — a brutally honest self-audit tool. "
    "Your job is to evaluate the ENTIRE prompting session: the user's strategy, "
    "the prompts they wrote, the modes they chose, and the quality of the iterative "
    "process. Be blunt. No praise. Only identify weaknesses, missed opportunities, "
    "and areas for improvement in the user's prompting approach.\n\n"
    "USER RATINGS: Some iterations may be marked STRONG or POOR by the user. These are "
    "direct taste signals. Your audit should focus on WHY the poorly-rated iterations "
    "failed (what the user likely objected to), what patterns emerge from strongly-rated "
    "ones, and whether the user's subsequent prompting strategy learned from their own "
    "ratings or kept making the same moves that led to poor outputs."
)

SELF_AUDIT_PROMPT = """Perform a Cold Critic self-audit of this PromptMaster session.

OBJECTIVE: {objective}
AUDIENCE: {audience}
CONSTRAINTS: {constraints}
ITERATIONS: {iteration_count}

{iteration_details}

Audit the user's prompting STRATEGY (not just the AI's output). Address:
1. Was the mode choice appropriate for this objective? Should they have switched modes?
2. Were the prompts specific enough, or too vague/generic?
3. Did the iteration process improve the output, or was it spinning in circles?
4. Were constraints and audience properly leveraged, or ignored?
5. What specific prompting mistakes did the user make?
6. If the user rated iterations STRONG or POOR, what patterns emerge? Did they learn from their own ratings?
7. What would a PromptMaster (Tier 4) have done differently?

Be harsh. Be specific. No praise. Only problems and concrete improvements."""


async def run_self_audit(
    client: OpenRouterClient,
    inputs: PMInput,
    iterations: list[Iteration],
    model: str | None = None,
) -> str:
    """Run a Cold Critic self-audit on the entire session (Ch9 concept)."""
    iteration_details = []
    for it in iterations:
        detail = f"--- Iteration {it.iteration_number} (Mode: {it.mode}) ---\n"
        detail += f"Prompt: {it.prompt_sent[:500]}{'...' if len(it.prompt_sent) > 500 else ''}\n"
        if it.evaluation:
            e = it.evaluation
            detail += f"Scores: Alignment={e.alignment.score}, Drift={e.drift.score}, Clarity={e.clarity.score}\n"
        if it.user_rating:
            rating_word = "STRONG (user liked)" if it.user_rating == "positive" else "POOR (user disliked)"
            detail += f"USER RATING: {rating_word}\n"
        detail += f"Output (first 300 chars): {it.output[:300]}..."
        iteration_details.append(detail)

    prompt = SELF_AUDIT_PROMPT.format(
        objective=inputs.objective,
        audience=inputs.audience,
        constraints=inputs.constraints or "(none)",
        iteration_count=len(iterations),
        iteration_details="\n\n".join(iteration_details),
    )

    content, _usage = await client.generate(
        prompt=prompt,
        system=SELF_AUDIT_SYSTEM,
        temperature=0.4,
        max_tokens=2048,
        model=model,
    )
    return content


def export_session_json(inputs: PMInput, iterations: list[Iteration], model: str = "") -> str:
    """Serialize a session to JSON for export/download."""
    # Convert iterations to dicts to avoid Pydantic class-identity
    # issues across Streamlit re-runs
    iter_dicts = [it.model_dump() if hasattr(it, 'model_dump') else it for it in iterations]
    session = Session(
        objective=inputs.objective,
        audience=inputs.audience,
        constraints=inputs.constraints,
        output_format=inputs.output_format,
        mode=inputs.mode,
        model=model,
        iterations=iter_dicts,
        finalized=True,
    )
    return session.model_dump_json(indent=2)
