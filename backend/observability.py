"""FR-19: structured logging and per-request correlation.

What stood here was `logging.basicConfig(level=INFO)` and twenty-four free-text
`logger.*` calls. That is enough to read a single line and guess what happened,
and not enough to answer the only question anyone actually asks in an incident:
*this user says their book failed at 4pm — show me everything that request did.*
There was no request id, no user id, and no way to join a line in the API to the
drain call that produced it.

Three pieces, and the boundaries between them are the point.

**Context, not parameters.** `request_id`, `user_id` and `project_id` live in
contextvars set once by the middleware, and every log line picks them up from
the formatter. The alternative — threading a correlation id through
`prompt_builder`, `evaluator`, `guidance` and `llm_client` — means every new
call site is a place to forget it, and the ones that forget are exactly the
error paths you needed.

**A mutable accumulator, deliberately.** `UsageAccumulator` is put into its
contextvar *before* `call_next` and only ever mutated, never rebound. Starlette
runs the downstream app in a child task, which copies the context at spawn: a
value *set* downstream is invisible up here, but an object *mutated* downstream
is the same object. That asymmetry is why `llm_client` appends to a list rather
than assigning a fresh one, and why this comment exists — the obvious
refactor to `usage_var.set(...)` inside the client would silently record
nothing.

**Correlation crosses the process boundary.** `X-Request-Id` is honoured when
the caller supplies one and echoed on every response. The drain generates one
per job step and passes it here, so a section that failed has a single id that
appears in the drain's log line, this API's log lines, and the `model_usage`
row — which is what makes FR-19's "diagnosis of background jobs" a query rather
than a correlation-by-timestamp exercise.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)

# Header names. `X-Request-Id` is the de-facto standard and is what a platform
# log drain will already know to index on; the other two are ours.
REQUEST_ID_HEADER = "X-Request-Id"
PROJECT_HEADER = "X-PromptMaster-Project"
USER_HEADER = "X-PromptMaster-User"
#: Response header carrying what this request spent. See `usage.py`.
USAGE_HEADER = "X-PromptMaster-Usage"


# ---------------------------------------------------------------------------
# Per-request context
# ---------------------------------------------------------------------------


@dataclass
class UsageEvent:
    """One provider call. The unit `model_usage` rows are written from."""

    model: str
    tokens_in: int
    tokens_out: int
    elapsed_ms: int
    #: Cost in USD when pricing was resolvable, else None. Never guessed: a
    #: wrong number on a cost page is worse than an honest blank.
    cost_usd: float | None = None
    prompt_price_usd: float | None = None
    completion_price_usd: float | None = None

    def as_header_entry(self) -> dict[str, Any]:
        """Compact form for the response header — short keys, small payload."""
        entry: dict[str, Any] = {
            "m": self.model,
            "i": self.tokens_in,
            "o": self.tokens_out,
            "ms": self.elapsed_ms,
        }
        if self.cost_usd is not None:
            entry["c"] = round(self.cost_usd, 8)
        if self.prompt_price_usd is not None:
            entry["pp"] = self.prompt_price_usd
        if self.completion_price_usd is not None:
            entry["cp"] = self.completion_price_usd
        return entry


@dataclass
class UsageAccumulator:
    """Mutable, per-request. Only ever appended to — see the module docstring."""

    events: list[UsageEvent] = field(default_factory=list)

    def add(self, event: UsageEvent) -> None:
        self.events.append(event)

    @property
    def tokens_in(self) -> int:
        return sum(e.tokens_in for e in self.events)

    @property
    def tokens_out(self) -> int:
        return sum(e.tokens_out for e in self.events)

    @property
    def cost_usd(self) -> float | None:
        priced = [e.cost_usd for e in self.events if e.cost_usd is not None]
        return sum(priced) if priced else None


request_id_var: ContextVar[str] = ContextVar("pm_request_id", default="")
user_id_var: ContextVar[str] = ContextVar("pm_user_id", default="")
project_id_var: ContextVar[str] = ContextVar("pm_project_id", default="")
route_var: ContextVar[str] = ContextVar("pm_route", default="")
usage_var: ContextVar[UsageAccumulator | None] = ContextVar("pm_usage", default=None)


def current_usage() -> UsageAccumulator | None:
    """The accumulator for the in-flight request, or None outside one."""
    return usage_var.get()


def log_context() -> dict[str, str]:
    """The correlation fields, omitting the ones that are not set."""
    out = {
        "request_id": request_id_var.get(),
        "user_id": user_id_var.get(),
        "project_id": project_id_var.get(),
        "route": route_var.get(),
    }
    return {k: v for k, v in out.items() if v}


def set_user(user_id: str) -> None:
    """Called once identity is known. Safe to call with an empty id."""
    if user_id:
        user_id_var.set(user_id)


# ---------------------------------------------------------------------------
# Formatter
# ---------------------------------------------------------------------------

#: Attributes `logging` puts on every record. Anything else a caller passed via
#: `extra=` is application data and belongs in the JSON body.
_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename",
    "funcName", "levelname", "levelno", "lineno", "message", "module",
    "msecs", "msg", "name", "pathname", "process", "processName",
    "relativeCreated", "stack_info", "taskName", "thread", "threadName",
}


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line.

    Structured rather than pretty because the consumer is `vercel logs` and a
    grep, not a human reading a terminal. The message is kept verbatim in
    `message` so the twenty-four existing free-text calls stay readable without
    being rewritten — they gain correlation for free and lose nothing.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(log_context())

        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = _safe(value)

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        try:
            return json.dumps(payload, default=str)
        except (TypeError, ValueError):
            # A log line must never be the thing that raises. Degrading to the
            # bare message is strictly better than losing the record.
            return json.dumps({"level": record.levelname, "message": record.getMessage()})


def _safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _safe(v) for k, v in value.items()}
    return str(value)


def structured_logging_enabled() -> bool:
    """Off in local dev by default: JSON lines are hostile to read in a terminal.

    Read per-call rather than at import so a test can flip it, and so the
    Vercel deployment can turn it on with an env change and no redeploy.
    """
    raw = os.getenv("LOG_FORMAT", "").strip().lower()
    if raw:
        return raw == "json"
    # No explicit setting: JSON when we look like a serverless deployment.
    return bool(os.getenv("VERCEL") or os.getenv("VERCEL_ENV"))


def configure_logging() -> None:
    """Install the root handler. Idempotent — safe on a re-import or reload."""
    level = getattr(logging, os.getenv("LOG_LEVEL", "INFO").strip().upper(), logging.INFO)
    root = logging.getLogger()
    root.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    if structured_logging_enabled():
        handler.setFormatter(JsonLogFormatter())
    else:
        # Human mode still carries the request id, so a local reproduction can
        # be followed the same way production is.
        handler.setFormatter(_PlainFormatter("%(levelname)s %(name)s %(message)s"))

    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)


class _PlainFormatter(logging.Formatter):
    """Dev formatter: the usual line, with `[req=…]` appended when there is one."""

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        ctx = log_context()
        rid = ctx.get("request_id")
        return f"{base} [req={rid[:8]}]" if rid else base


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class ObservabilityMiddleware(BaseHTTPMiddleware):
    """Correlation in, usage out.

    Ordering matters: this must be the outermost middleware so that a request
    rejected by CORS, by auth, or by the rate limiter still produces one
    correlated access line. An error you cannot see is the FR-19 failure.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        incoming = (request.headers.get(REQUEST_ID_HEADER) or "").strip()
        # A caller-supplied id is trusted for correlation only — it is never an
        # authorisation input — but it is still length-capped so a hostile
        # client cannot write unbounded junk into our logs.
        request_id = incoming[:64] if incoming else uuid.uuid4().hex

        request_id_var.set(request_id)
        project_id_var.set((request.headers.get(PROJECT_HEADER) or "").strip()[:64])
        route_var.set(request.url.path)
        user_id_var.set("")
        accumulator = UsageAccumulator()
        usage_var.set(accumulator)
        request.state.usage = accumulator
        request.state.request_id = request_id

        started = time.monotonic()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            # `user_id` is set by the auth dependency downstream, which for a
            # BaseHTTPMiddleware child task means we cannot read it back here.
            # The access line below therefore reports what the middleware knows;
            # the per-call usage lines carry the user, because they are emitted
            # downstream where it is set.
            logger.exception(
                "request_failed",
                extra={"http_status": 500, "duration_ms": _ms(started)},
            )
            raise

        _annotate(response, request_id, accumulator)
        logger.info(
            "request_completed",
            extra={
                "http_status": status,
                "duration_ms": _ms(started),
                "method": request.method,
                "tokens_in": accumulator.tokens_in,
                "tokens_out": accumulator.tokens_out,
                "llm_calls": len(accumulator.events),
            },
        )
        return response


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


#: A response header has a practical size ceiling, and a request that made
#: forty calls does not need forty entries to be meterable. Beyond this the
#: entries are folded per model, which preserves every token and every dollar
#: and loses only the per-call breakdown.
_MAX_HEADER_EVENTS = 12


def _annotate(response: Response, request_id: str, usage: UsageAccumulator) -> None:
    """Attach correlation and usage headers to an outgoing response."""
    response.headers[REQUEST_ID_HEADER] = request_id
    if not usage.events:
        return

    events = usage.events
    if len(events) > _MAX_HEADER_EVENTS:
        events = _fold_by_model(events)

    try:
        response.headers[USAGE_HEADER] = json.dumps(
            [e.as_header_entry() for e in events], separators=(",", ":")
        )
    except (TypeError, ValueError):
        # Metering is best-effort by construction: it must never be the reason
        # a successful generation fails to reach the user.
        logger.warning("usage_header_serialisation_failed")


def _fold_by_model(events: list[UsageEvent]) -> list[UsageEvent]:
    folded: dict[str, UsageEvent] = {}
    for event in events:
        existing = folded.get(event.model)
        if existing is None:
            folded[event.model] = UsageEvent(
                model=event.model,
                tokens_in=event.tokens_in,
                tokens_out=event.tokens_out,
                elapsed_ms=event.elapsed_ms,
                cost_usd=event.cost_usd,
                prompt_price_usd=event.prompt_price_usd,
                completion_price_usd=event.completion_price_usd,
            )
            continue
        existing.tokens_in += event.tokens_in
        existing.tokens_out += event.tokens_out
        existing.elapsed_ms += event.elapsed_ms
        if event.cost_usd is not None:
            existing.cost_usd = (existing.cost_usd or 0.0) + event.cost_usd
    return list(folded.values())
