"""FastAPI backend for PromptMaster Engine."""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

from deps import lifespan_client
from auth import require_user
from observability import ObservabilityMiddleware, configure_logging
from ratelimit import enforce_rate_limit
from validation import validation_error_payload

# FR-19: structured, correlated lines instead of `basicConfig(level=INFO)`.
# See observability.py for why the correlation lives in contextvars.
configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: start/stop shared OpenRouterClient."""
    async with lifespan_client():
        logger.info("PromptMaster backend started")
        yield
    logger.info("PromptMaster backend stopped")


app = FastAPI(
    title="PromptMaster Engine API",
    version="1.0.0",
    lifespan=lifespan,
)

# FR-19. Added before CORS so it is the OUTERMOST middleware: Starlette applies
# these in reverse order of registration, and a request rejected by CORS must
# still produce one correlated access line. An error you cannot see is exactly
# the failure this requirement exists to close.
app.add_middleware(ObservabilityMiddleware)

# CORS
allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this the browser cannot read either header off the response, so
    # the client could not record usage and could not report a request id with
    # a bug. Both are same-origin-invisible by default on a cross-origin fetch.
    expose_headers=["X-Request-Id", "X-PromptMaster-Usage", "Retry-After"],
)


@app.exception_handler(RequestValidationError)
async def on_validation_error(request: Request, exc: RequestValidationError):
    """FR-18: an over-size request must say so in words a person can act on.

    FastAPI's default 422 body is a list of `{loc, msg, type}` objects. For a
    field that failed `max_length` that renders in the UI as
    `String should have at most 8000 characters` against a `loc` of
    `["body","inputs","objective"]` — accurate, and useless to someone who does
    not know the request schema.

    This reshapes it into the same FR-16 detail object every other error uses,
    so the existing recovery panel renders it with no special case, and names
    the field and the limit in the message. The raw errors stay available in
    `detail.detail` for the technical-details disclosure.
    """
    logger.warning(
        "request_rejected_validation",
        extra={"event": "validation_error", "error_count": len(exc.errors())},
    )
    return JSONResponse(status_code=422, content={"detail": validation_error_payload(exc)})


@app.get("/api/health")
async def health():
    return {"status": "ok"}


from routers.meta import router as meta_router
from routers.engine import router as engine_router
from routers.conversation import router as conversation_router
from routers.continuation import router as continuation_router
from routers.setup import router as setup_router
from routers.audit import router as audit_router
from routers.long_form import router as long_form_router
from routers.stage import router as stage_router
from routers.usage import router as usage_router

# Auth is applied at include time, not per-endpoint, so a new route cannot be
# added unprotected by omission. test_auth.py asserts this holds.
#
# FR-18: the rate limiter rides the same wiring, for the same reason — a new
# router cannot ship unmetered by omission. `enforce_rate_limit` itself depends
# on `require_user`, so identity is resolved once and the limiter can never run
# on an unauthenticated request (which would have to key on IP, and every
# serverless caller shares a small pool of egress addresses).
_protected = [Depends(require_user), Depends(enforce_rate_limit)]

# meta_router is public: /api/modes is static data from promptmaster/modes.py
# and the marketing page reads it. /api/models proxies OpenRouter, so it is
# protected separately inside that router.
app.include_router(meta_router)
app.include_router(engine_router, dependencies=_protected)
app.include_router(conversation_router, dependencies=_protected)
app.include_router(continuation_router, dependencies=_protected)
app.include_router(setup_router, dependencies=_protected)
app.include_router(audit_router, dependencies=_protected)
app.include_router(long_form_router, dependencies=_protected)
app.include_router(stage_router, dependencies=_protected)
app.include_router(usage_router, dependencies=_protected)
