"""FR-16 error taxonomy: turn a provider failure into something a person can act on.

The rule this module exists to enforce is that **every message says what was
preserved**. A long-form draft is the case that makes it matter: a user who has
paid for six sections and sees "LLM error: HTTP 402" has no way to know whether
those six sections still exist. "Nothing was lost — 6 of 10 sections are saved"
is the same failure, reported honestly.

Classification is deliberately structured-first and string-second. The
`OpenRouterError` fields (`status_code`, `provider_code`, `retry_after`) are
authoritative when present; the substring pass exists only so that errors raised
by older code paths — which never set those fields — still land somewhere
sensible instead of falling through to "unknown".
"""

from __future__ import annotations

from dataclasses import dataclass

from .llm_client import OpenRouterDeadlineError, OpenRouterError

# ---------------------------------------------------------------------------
# Codes
# ---------------------------------------------------------------------------

INSUFFICIENT_CREDITS = "insufficient_credits"
RATE_LIMITED = "rate_limited"
CONTEXT_LENGTH = "context_length"
OUTPUT_TRUNCATED = "output_truncated"
FUNCTION_TIMEOUT = "function_timeout"
JOB_DEAD = "job_dead"
PROVIDER_UNAVAILABLE = "provider_unavailable"
INVALID_REQUEST = "invalid_request"
UNKNOWN = "unknown"


@dataclass(frozen=True)
class ClassifiedError:
    """A failure, described the way it should be shown to a person.

    `retryable` means "another attempt could plausibly succeed without the user
    changing anything" — which is what the job drain branches on when deciding
    between re-queueing and marking a job dead.
    """

    code: str
    title: str
    #: Plain-language recovery, with no placeholder for preservation. Callers
    #: append that via `with_preserved`, because only the caller knows the count.
    message: str
    retryable: bool
    retry_after: float | None = None

    def with_preserved(self, preserved: str | None) -> "ClassifiedError":
        """Append the reassurance clause. This is the FR-16 requirement.

        `preserved` is a caller-supplied phrase such as
        "6 of 10 sections are saved". Passing None is allowed but should be rare
        — it means the caller genuinely does not know, and the message then says
        nothing about preservation rather than claiming something false.
        """
        if not preserved:
            return self
        return ClassifiedError(
            code=self.code,
            title=self.title,
            message=f"{self.message} Nothing was lost — {preserved}.",
            retryable=self.retryable,
            retry_after=self.retry_after,
        )


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

# Provider codes seen in the wild for "the prompt does not fit". OpenRouter
# passes these through from whichever upstream served the request, so there is
# no single spelling to match on.
_CONTEXT_CODES = {
    "context_length_exceeded",
    "context_length",
    "string_above_max_length",
    "max_tokens_exceeded",
}

_CREDIT_CODES = {"insufficient_credits", "insufficient_quota", "billing_hard_limit_reached"}


def _from_status(status: int, provider_code: str | None, retry_after: float | None) -> ClassifiedError:
    if status == 402:
        return _credits()
    if status == 429:
        return _rate_limited(retry_after)
    if status in (400, 413) and (provider_code or "") in _CONTEXT_CODES:
        return _context_length()
    if status in (500, 502, 503, 504):
        return ClassifiedError(
            code=PROVIDER_UNAVAILABLE,
            title="The model provider is having trouble",
            message="This is on their side, not yours. Trying again shortly usually works.",
            retryable=True,
            retry_after=retry_after,
        )
    if 400 <= status < 500:
        return ClassifiedError(
            code=INVALID_REQUEST,
            title="The request was rejected",
            message="The model provider refused this request. Changing the model or shortening the objective is the usual fix.",
            retryable=False,
        )
    return _unknown()


def _credits() -> ClassifiedError:
    return ClassifiedError(
        code=INSUFFICIENT_CREDITS,
        title="Out of model credits",
        message="The OpenRouter account has run out of credit, so no further sections can be generated until it is topped up.",
        retryable=False,
    )


def _rate_limited(retry_after: float | None) -> ClassifiedError:
    when = f" Try again in about {int(retry_after)}s." if retry_after else " It will resume on its own shortly."
    return ClassifiedError(
        code=RATE_LIMITED,
        title="Rate limited by the model provider",
        message=f"Too many requests went out too quickly.{when}",
        retryable=True,
        retry_after=retry_after,
    )


def _context_length() -> ClassifiedError:
    return ClassifiedError(
        code=CONTEXT_LENGTH,
        title="The prompt was too long for this model",
        message="This section's context exceeded the model's limit. Shortening the outline abstracts, or choosing a model with a larger context window, will clear it.",
        retryable=False,
    )


def _unknown() -> ClassifiedError:
    return ClassifiedError(
        code=UNKNOWN,
        title="Generation failed",
        message="Something went wrong while generating. Retrying is safe.",
        retryable=True,
    )


def classify_error(error: BaseException) -> ClassifiedError:
    """Map any exception onto the taxonomy.

    Deliberately total: an unrecognised exception classifies as `unknown` and
    retryable, because the alternative — letting an unexpected error type escape
    into the UI as a stack trace — is the exact FR-16 failure.
    """
    if isinstance(error, OpenRouterDeadlineError):
        return function_timeout()

    if isinstance(error, OpenRouterError):
        provider_code = error.provider_code
        if provider_code in _CREDIT_CODES:
            return _credits()
        if provider_code in _CONTEXT_CODES:
            return _context_length()
        if error.status_code is not None:
            return _from_status(error.status_code, provider_code, error.retry_after)
        if provider_code in ("timeout", "network"):
            return ClassifiedError(
                code=PROVIDER_UNAVAILABLE,
                title="Could not reach the model provider",
                message="The request did not complete. Trying again shortly usually works.",
                retryable=True,
            )
        # Fallback for errors raised before the structured fields existed.
        return _from_message(str(error))

    return _unknown()


def _from_message(message: str) -> ClassifiedError:
    """Last-resort substring pass, kept so pre-existing call sites still classify."""
    lowered = message.lower()
    if "402" in message or "credit" in lowered or "quota" in lowered:
        return _credits()
    if "429" in message or "rate limit" in lowered:
        return _rate_limited(None)
    if "context" in lowered and "length" in lowered:
        return _context_length()
    if "timed out" in lowered or "network error" in lowered:
        return ClassifiedError(
            code=PROVIDER_UNAVAILABLE,
            title="Could not reach the model provider",
            message="The request did not complete. Trying again shortly usually works.",
            retryable=True,
        )
    if any(code in message for code in ("500", "502", "503", "504")):
        return ClassifiedError(
            code=PROVIDER_UNAVAILABLE,
            title="The model provider is having trouble",
            message="This is on their side, not yours. Trying again shortly usually works.",
            retryable=True,
        )
    return _unknown()


# ---------------------------------------------------------------------------
# Conditions that are not exceptions
# ---------------------------------------------------------------------------
#
# Three of the six FR-16 cases drafting needs are not raised by the LLM client
# at all — they are states the drain observes — so they get constructors rather
# than falling out of `classify_error`.


def function_timeout() -> ClassifiedError:
    """The serverless function ran out of wall clock mid-job.

    Explicitly retryable and explicitly reassuring: this is the case the lease
    exists for, and the user should understand it as "paused", not "failed".
    """
    return ClassifiedError(
        code=FUNCTION_TIMEOUT,
        title="Paused — the run hit its time limit",
        message="Generation stopped partway through and will pick up automatically from where it left off.",
        retryable=True,
    )


def output_truncated() -> ClassifiedError:
    """The model stopped because it hit max_tokens, not because it was finished."""
    return ClassifiedError(
        code=OUTPUT_TRUNCATED,
        title="A section was cut short",
        message="The model reached its output limit mid-sentence. Regenerating that one section usually completes it.",
        retryable=True,
    )


def job_dead(attempts: int) -> ClassifiedError:
    """Retries are exhausted; this needs a person."""
    return ClassifiedError(
        code=JOB_DEAD,
        title="Gave up on this section",
        message=f"This section failed {attempts} times, so automatic retrying has stopped. Retry it by hand once the underlying problem is fixed.",
        retryable=False,
    )
