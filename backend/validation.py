"""FR-18: turning a schema rejection into a sentence someone can act on.

The caps in `promptmaster/limits.py` are only half of "generation-size controls".
The other half is that hitting one has to be *legible*. FastAPI's default 422 is

    {"detail": [{"loc": ["body","suggested_section_count"],
                 "msg": "Input should be less than or equal to 40",
                 "type": "less_than_equal"}]}

which the client's error path renders as `API error: 422`, because
`lib/api/client.ts` reads `detail` as a string or as the FR-16 object and this
is neither. So the user who asked for 500 sections is told nothing at all.

This module maps the rejection onto the same detail object every other error in
the system uses — `code`, `title`, `message`, `retryable` — so the existing
recovery panel renders it with no new branch, and the message names the field,
the value and the limit.

`code` is `invalid_request`, which is already in the taxonomy and whose action
set (`shorten`, `switch_model`, `details`) is exactly right for "you asked for
too much". A new code would mean widening the `ErrorCode` union and
`ACTIONS_FOR` on the client to arrive at the same three affordances.
"""

from __future__ import annotations

from typing import Any

from fastapi.exceptions import RequestValidationError

#: Field names are schema jargon. These are the ones a user can actually see a
#: control for, named the way the UI names them.
_FRIENDLY: dict[str, str] = {
    "suggested_section_count": "the number of sections",
    "objective": "the objective",
    "constraints": "the constraints",
    "output_format": "the output format",
    "audience": "the audience",
    "session_facts": "the session facts",
    "custom_preamble": "the custom persona instructions",
    "merged_content": "the document",
    "section_content": "the section",
    "prev_section_content": "the previous section",
    "outline": "the outline",
    "iteration_history": "the version history",
    "records": "the continuity records",
    "model": "the model",
}


def _field_path(loc: tuple | list) -> str:
    """`("body","inputs","objective")` -> `"objective"`.

    The leading `body` is noise, and for a nested model the leaf is the field
    the user changed. Numeric indices are dropped for the same reason.
    """
    parts = [str(p) for p in loc if str(p) not in ("body", "query", "path") and not str(p).isdigit()]
    return parts[-1] if parts else ""


def _describe(error: dict[str, Any]) -> str:
    """One rejected field, as a sentence."""
    field = _field_path(error.get("loc") or ())
    label = _FRIENDLY.get(field, f"`{field}`" if field else "part of the request")
    ctx = error.get("ctx") or {}
    kind = str(error.get("type") or "")

    if kind in ("less_than_equal", "less_than"):
        limit = ctx.get("le", ctx.get("lt"))
        return f"{label} is above the maximum of {_num(limit)}"
    if kind in ("greater_than_equal", "greater_than"):
        limit = ctx.get("ge", ctx.get("gt"))
        return f"{label} is below the minimum of {_num(limit)}"
    if kind in ("string_too_long", "too_long"):
        limit = ctx.get("max_length")
        unit = "items" if kind == "too_long" else "characters"
        return f"{label} is longer than the {_num(limit)}-{unit.rstrip('s')} limit"
    if kind in ("string_too_short", "too_short", "missing"):
        return f"{label} is required"
    if kind == "value_error":
        # Our own validators (see PMInput.session_facts) already write a full
        # sentence, so it is used verbatim rather than paraphrased.
        msg = str(error.get("msg") or "").removeprefix("Value error, ").strip()
        return msg or f"{label} is not valid"
    return f"{label} is not valid"


def _num(value: object) -> str:
    try:
        return f"{int(value):,}"
    except (TypeError, ValueError):
        return str(value)


def validation_error_payload(exc: RequestValidationError) -> dict:
    """The FR-16 detail object for a schema rejection."""
    errors = exc.errors()
    problems = []
    for error in errors[:5]:  # Five is plenty; listing forty helps nobody.
        described = _describe(error)
        if described not in problems:
            problems.append(described)

    if not problems:
        summary = "The request was not in a shape this endpoint accepts."
    elif len(problems) == 1:
        summary = f"{problems[0].capitalize()}."
    else:
        summary = "; ".join(problems).capitalize() + "."

    return {
        "code": "invalid_request",
        "title": "That request asked for too much",
        "message": (
            f"{summary} Nothing was generated and nothing was charged — the request "
            "was refused before it reached the model. Adjusting the value above and "
            "trying again will work."
        ),
        "retryable": False,
        "retry_after": None,
        "provider_status": None,
        # The raw pydantic errors, for the technical-details disclosure. Kept as
        # a string because `detail.detail` is contracted to be one.
        "detail": _safe_repr(errors),
    }


def _safe_repr(errors: list[dict[str, Any]]) -> str:
    """`repr` of the raw errors, defensively — pydantic ctx can hold anything.

    A `ctx` carrying a non-serialisable exception instance is the known case;
    letting that raise inside an error handler would turn a clean 422 into a
    500 with no body at all.
    """
    try:
        return "; ".join(
            f"{'.'.join(str(p) for p in (e.get('loc') or ()))}: {e.get('msg')}" for e in errors[:5]
        ) or "Request validation failed"
    except Exception:  # pragma: no cover - defensive
        return "Request validation failed"
