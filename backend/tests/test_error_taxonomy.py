"""FR-16: a provider failure becomes something a person can act on.

Two properties matter here. First, classification is structured-first — an
OpenRouterError carrying status 402 is "out of credits" regardless of what its
message string happens to say. Second, the substring fallback still works, so
every error raised by code written before the structured fields existed lands
where it always did rather than collapsing into "unknown".
"""

from __future__ import annotations

import httpx
import pytest

from promptmaster import errors
from promptmaster.errors import classify_error, job_dead, output_truncated
from promptmaster.llm_client import (
    OpenRouterClient,
    OpenRouterDeadlineError,
    OpenRouterError,
    _provider_code,
    _retry_after_seconds,
)


# ---------------------------------------------------------------------------
# Structured classification
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "status, provider_code, expected",
    [
        (402, None, errors.INSUFFICIENT_CREDITS),
        (429, None, errors.RATE_LIMITED),
        (400, "context_length_exceeded", errors.CONTEXT_LENGTH),
        (413, "string_above_max_length", errors.CONTEXT_LENGTH),
        (503, None, errors.PROVIDER_UNAVAILABLE),
        (400, None, errors.INVALID_REQUEST),
    ],
)
def test_status_code_drives_classification(status, provider_code, expected):
    err = OpenRouterError("opaque message", status_code=status, provider_code=provider_code)
    assert classify_error(err).code == expected


def test_provider_code_wins_over_status():
    """A 400 that says 'insufficient_credits' is a billing problem, not a bad request."""
    err = OpenRouterError("HTTP 400", status_code=400, provider_code="insufficient_credits")
    assert classify_error(err).code == errors.INSUFFICIENT_CREDITS


def test_rate_limit_carries_retry_after():
    err = OpenRouterError("slow down", status_code=429, retry_after=30.0)
    classified = classify_error(err)
    assert classified.retry_after == 30.0
    assert "30s" in classified.message
    assert classified.retryable is True


def test_credits_is_not_retryable():
    """Retrying an out-of-credit account just burns the retry budget."""
    assert classify_error(OpenRouterError("x", status_code=402)).retryable is False


def test_context_length_is_not_retryable():
    err = OpenRouterError("x", status_code=400, provider_code="context_length_exceeded")
    assert classify_error(err).retryable is False


def test_deadline_classifies_as_function_timeout():
    classified = classify_error(OpenRouterDeadlineError("out of budget"))
    assert classified.code == errors.FUNCTION_TIMEOUT
    # It must read as paused, not failed — the lease will re-claim it.
    assert classified.retryable is True


def test_unknown_exception_is_total_and_retryable():
    classified = classify_error(RuntimeError("something nobody planned for"))
    assert classified.code == errors.UNKNOWN
    assert classified.retryable is True


# ---------------------------------------------------------------------------
# The string fallback, for errors raised before the fields existed
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "message, expected",
    [
        ("Server error (HTTP 429): too many", errors.RATE_LIMITED),
        ("HTTP 402: insufficient credits", errors.INSUFFICIENT_CREDITS),
        ("This model's maximum context length is 8192", errors.CONTEXT_LENGTH),
        ("Request timed out after 55.0s", errors.PROVIDER_UNAVAILABLE),
        ("Network error: connection reset", errors.PROVIDER_UNAVAILABLE),
        ("Server error (HTTP 503): upstream", errors.PROVIDER_UNAVAILABLE),
        ("No content in response", errors.UNKNOWN),
    ],
)
def test_message_fallback_when_no_status_code(message, expected):
    assert classify_error(OpenRouterError(message)).code == expected


# ---------------------------------------------------------------------------
# The FR-16 rule: every message says what was preserved
# ---------------------------------------------------------------------------

def test_with_preserved_appends_the_reassurance():
    classified = classify_error(OpenRouterError("x", status_code=402))
    message = classified.with_preserved("6 of 10 sections are saved").message
    assert "Nothing was lost — 6 of 10 sections are saved." in message


def test_with_preserved_says_nothing_rather_than_something_false():
    """A caller that does not know what survived must not claim anything."""
    classified = classify_error(OpenRouterError("x", status_code=402))
    assert classified.with_preserved(None).message == classified.message
    assert "Nothing was lost" not in classified.with_preserved("").message


def test_with_preserved_keeps_code_and_retryability():
    original = classify_error(OpenRouterError("x", status_code=429, retry_after=5.0))
    updated = original.with_preserved("3 of 10 sections are saved")
    assert updated.code == original.code
    assert updated.retryable == original.retryable
    assert updated.retry_after == original.retry_after


def test_non_exception_conditions_have_constructors():
    assert output_truncated().code == errors.OUTPUT_TRUNCATED
    dead = job_dead(attempts=3)
    assert dead.code == errors.JOB_DEAD
    assert dead.retryable is False
    assert "3 times" in dead.message


# ---------------------------------------------------------------------------
# The client populates the fields the taxonomy reads
# ---------------------------------------------------------------------------

def _response(status: int, body: dict | None = None, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(
        status,
        json=body if body is not None else {},
        headers=headers or {},
        request=httpx.Request("POST", "https://openrouter.ai"),
    )


def test_provider_code_read_from_error_body():
    r = _response(400, {"error": {"code": "context_length_exceeded", "message": "too long"}})
    assert _provider_code(r) == "context_length_exceeded"


def test_provider_code_falls_back_to_type():
    r = _response(400, {"error": {"type": "invalid_request_error"}})
    assert _provider_code(r) == "invalid_request_error"


def test_provider_code_none_when_body_is_not_an_error_envelope():
    assert _provider_code(_response(400, {"choices": []})) is None


def test_provider_code_survives_a_non_json_body():
    r = httpx.Response(502, text="<html>gateway</html>", request=httpx.Request("POST", "https://x"))
    assert _provider_code(r) is None


def test_retry_after_parsed_from_header():
    assert _retry_after_seconds(_response(429, headers={"retry-after": "12"})) == 12.0


def test_retry_after_none_for_http_date_form():
    """A wrong guess is worse than falling back to the standard ladder."""
    r = _response(429, headers={"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"})
    assert _retry_after_seconds(r) is None


def test_is_retryable_prefers_status_over_substring():
    """A 402 whose message mentions '503' must not be retried."""
    client = OpenRouterClient(api_key="k")
    err = OpenRouterError("billing declined; ref 503", status_code=402)
    assert client._is_retryable(err) is False


def test_is_retryable_keeps_the_substring_fallback():
    client = OpenRouterClient(api_key="k")
    assert client._is_retryable(OpenRouterError("Server error (HTTP 503): x")) is True
    assert client._is_retryable(OpenRouterError("No content in response")) is False
