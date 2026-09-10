"""FR-18: the pre-flight estimate — "large jobs can trigger a warning".

One endpoint, `POST /api/estimate-job`, and it makes **no LLM call**. That is
the design constraint, not an optimisation. A warning that has to wait on a
model round-trip is a warning that appears after the user has already clicked
through, and a warning that itself costs money to produce is an absurdity in a
cost control.

So this is arithmetic over `promptmaster/limits.py` plus the live OpenRouter
price for the model actually configured, and it answers three questions the
client needs before it enqueues a book:

  - how many provider calls this will make (two per section — prose, then the
    FR-06 record extraction);
  - roughly what it will cost, or an honest null when the price is not known;
  - whether that is large enough to stop and ask.

The estimate is deliberately coarse and says so. Its job is to distinguish "a
chapter" from "an accident", not to invoice anyone — `model_usage` records what
was *actually* spent, per call, after the fact. Presenting a token estimate to
four significant figures would imply an accuracy it cannot have.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from promptmaster.limits import (
    CALLS_PER_SECTION,
    LARGE_JOB_SECTION_THRESHOLD,
    MAX_MODEL_SLUG_CHARS,
    MAX_SECTION_COUNT,
    MIN_SECTION_COUNT,
    estimate_long_form_tokens,
)
from pricing import pricing_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["usage"])


class EstimateJobRequest(BaseModel):
    """What the client is about to enqueue."""

    section_count: int = Field(..., ge=MIN_SECTION_COUNT, le=MAX_SECTION_COUNT)
    model: str = Field(default="", max_length=MAX_MODEL_SLUG_CHARS)


class EstimateJobResponse(BaseModel):
    section_count: int
    llm_calls: int
    estimated_tokens_in: int
    estimated_tokens_out: int
    #: None when the model's price is not in the cache. The client must render
    #: that as "cost unknown", never as $0.00 — see pricing.py.
    estimated_cost_usd: float | None
    #: Whether the client should confirm before spending.
    is_large: bool
    #: One sentence, written here rather than in the client so the threshold and
    #: the copy that explains it cannot drift apart.
    warning: str | None


@router.post("/estimate-job", response_model=EstimateJobResponse)
async def estimate_job(req: EstimateJobRequest) -> EstimateJobResponse:
    tokens_in, tokens_out = estimate_long_form_tokens(req.section_count)
    calls = req.section_count * CALLS_PER_SECTION

    price = pricing_cache().get(req.model)
    # Warm for next time; never block this response on a price lookup.
    pricing_cache().ensure_fresh()
    cost = price.cost(tokens_in, tokens_out) if price else None

    is_large = req.section_count >= LARGE_JOB_SECTION_THRESHOLD
    warning = None
    if is_large:
        money = f" and cost roughly ${cost:,.2f}" if cost is not None else ""
        warning = (
            f"This will draft {req.section_count} sections in {calls} model calls{money}. "
            "Drafting runs in the background and can be paused at any time, and "
            "sections already written are kept."
        )

    logger.info(
        "job_estimated",
        extra={
            "event": "job_estimated",
            "section_count": req.section_count,
            "llm_calls": calls,
            "estimated_cost_usd": round(cost, 4) if cost is not None else None,
            "is_large": is_large,
            "model": req.model,
        },
    )

    return EstimateJobResponse(
        section_count=req.section_count,
        llm_calls=calls,
        estimated_tokens_in=tokens_in,
        estimated_tokens_out=tokens_out,
        estimated_cost_usd=round(cost, 4) if cost is not None else None,
        is_large=is_large,
        warning=warning,
    )
