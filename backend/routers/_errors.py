"""FR-16 at the HTTP boundary: the one place a provider failure becomes a response.

`promptmaster/errors.py` has classified nine kinds of failure since the job
drain landed, and until now nothing in the request path called it. Every
synchronous endpoint raised `HTTPException(502, "LLM error: <repr>")`, so a
user who ran out of credit halfway through a stage saw the string
``LLM error: OpenRouter API error: HTTP 402`` and had no way to tell whether
their work still existed.

Two decisions are encoded here.

**The detail is an object, not a string.** FastAPI serialises `detail`
verbatim, so a dict gives the client a `code` to branch on and a `message` to
show, instead of forcing it to substring-match an error string that has been
through two hops. The legacy string is still carried, as `detail.detail` — so
an older client reading `detail` as text degrades to exactly what it saw
before, and the new client has something concrete to put behind "view
technical details".

**The HTTP status stays 502.** It is tempting to pass 402 and 429 through, but
502 is honest — *this* server did not run out of credit, its upstream did — and
the client's 401-refresh path and every existing test key off the status. The
provider's own status travels inside the detail where it belongs.

`preserved` is the FR-16 requirement and the reason this helper takes an
argument at all: only the caller knows what survived. Routers that know pass a
phrase; `promptmaster.errors.ClassifiedError.with_preserved` appends it. The
client appends its own clause when the server could not, so the guarantee that
*every* message says what was preserved holds end to end.
"""

from __future__ import annotations

from fastapi import HTTPException

from promptmaster.errors import ClassifiedError, classify_error


def error_payload(error: BaseException, preserved: str | None = None) -> dict:
    """Classify `error` and shape it into an HTTPException detail body."""
    classified: ClassifiedError = classify_error(error).with_preserved(preserved)
    return {
        "code": classified.code,
        "title": classified.title,
        "message": classified.message,
        "retryable": classified.retryable,
        "retry_after": classified.retry_after,
        # The provider's own status, for the technical-details disclosure. Not
        # the response status: see the module docstring.
        "provider_status": getattr(error, "status_code", None),
        # Byte-for-byte what this endpoint used to return, so nothing regresses
        # for a caller that reads `detail` as a string.
        "detail": f"LLM error: {error}",
    }


def llm_http_error(error: BaseException, preserved: str | None = None) -> HTTPException:
    """The exception a router should raise from an `except OpenRouterError` block."""
    return HTTPException(status_code=502, detail=error_payload(error, preserved))
