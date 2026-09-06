"""Shared helpers used by routers that create iterations.

Currently used by:
- routers/conversation.py (apply-to-answer, save-as-new-version)
- routers/continuation.py (continue-document)
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Awaitable

from promptmaster.evaluator import evaluate_output
from promptmaster.guidance import generate_suggestions
from promptmaster.llm_client import OpenRouterClient
from promptmaster.schemas import (
    ChatMessage,
    CompletenessResult,
    EvaluationResult,
    Iteration,
    PMInput,
)
from promptmaster.summaries import generate_summary


def force_incomplete_on_length(
    evaluation: EvaluationResult | None,
    finish_reason: str,
) -> EvaluationResult | None:
    """If the LLM hit max_tokens, force completeness=incomplete regardless of LLM judgment."""
    if finish_reason != "length" or evaluation is None:
        return evaluation
    return evaluation.model_copy(
        update={
            "completeness": CompletenessResult(
                status="incomplete",
                reason="Output reached the model's length limit.",
            )
        }
    )


async def build_iteration_with_full_pipeline(
    *,
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    output: str,
    iteration_number: int,
    system_text: str,
    prompt_text: str,
    trigger_source: str,
    active_iteration: Iteration | None,
    chat_history: list[ChatMessage],
    iteration_history: list[Iteration],
    user_action_label: str,
    finish_reason: str = "stop",
    instruction: str = "",
) -> tuple[Iteration, list[str]]:
    """Run eval + suggestions + summary in parallel, then assemble the iteration.

    If finish_reason='length', overrides evaluation.completeness to incomplete after
    the eval call returns. Returns (iteration, suggestions).

    active_iteration is the version this one supersedes. Pass None for a first
    iteration: there is nothing to summarise a change against, so the summary
    call is skipped entirely and summary stays None.
    """
    created_at = datetime.now(timezone.utc).isoformat()

    iteration_draft = Iteration(
        iteration_number=iteration_number,
        prompt_sent=prompt_text,
        system_prompt_used=system_text,
        output=output,
        mode=inputs.mode,
        evaluation=None,
        trigger_source=trigger_source,
        created_at=created_at,
        model_used=model or "",
        instruction=instruction,
    )

    eval_task: Awaitable[EvaluationResult] = evaluate_output(
        client, inputs, output, iterations=iteration_history, model=model
    )
    suggestions_task: Awaitable[list[str]] = generate_suggestions(
        client=client,
        inputs=inputs,
        output=output,
        iterations=iteration_history,
        model=model,
    )
    if active_iteration is not None:
        summary_task: Awaitable[str] = generate_summary(
            client=client,
            model=model,
            inputs=inputs,
            prev_iter=active_iteration,
            new_iter=iteration_draft,
            chat_history=chat_history,
            user_action=user_action_label,
        )
        evaluation, suggestions, summary = await asyncio.gather(
            eval_task, suggestions_task, summary_task
        )
    else:
        evaluation, suggestions = await asyncio.gather(eval_task, suggestions_task)
        summary = None

    # Mechanical pre-filter: if model hit length, force incomplete regardless of LLM judgment
    evaluation = force_incomplete_on_length(evaluation, finish_reason)

    iteration = Iteration(
        iteration_number=iteration_number,
        prompt_sent=prompt_text,
        system_prompt_used=system_text,
        output=output,
        mode=inputs.mode,
        evaluation=evaluation,
        trigger_source=trigger_source,
        summary=summary,
        created_at=created_at,
        model_used=model or "",
        instruction=instruction,
    )
    return iteration, suggestions
