"""FastAPI backend for PromptMaster Engine."""

import os
import logging
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from deps import lifespan_client
from auth import require_user

logging.basicConfig(level=logging.INFO)
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

# CORS
allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in allowed_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

# Auth is applied at include time, not per-endpoint, so a new route cannot be
# added unprotected by omission. test_auth.py asserts this holds.
_protected = [Depends(require_user)]

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
