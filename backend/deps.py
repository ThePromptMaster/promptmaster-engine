"""Dependency injection for FastAPI endpoints."""

import os
from contextlib import asynccontextmanager
from promptmaster.llm_client import OpenRouterClient

_client: OpenRouterClient | None = None


def get_api_key() -> str:
    """Get the OpenRouter API key from environment."""
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY environment variable is required")
    return key


def llm_mode() -> str:
    """'mock' serves scripted replies (E2E only); anything else is the real provider.

    Refuses mock mode on a production deployment: a mis-set env var there
    would quietly replace every answer a paying user gets with canned text,
    which is worse than failing to boot.
    """
    mode = os.getenv("PM_LLM_MODE", "").strip().lower()
    if mode == "mock" and os.getenv("VERCEL_ENV", "").strip().lower() == "production":
        raise RuntimeError("PM_LLM_MODE=mock is not allowed when VERCEL_ENV=production")
    return "mock" if mode == "mock" else "live"


def _build_client() -> OpenRouterClient:
    if llm_mode() == "mock":
        from promptmaster.mock_llm import ScriptedClient

        return ScriptedClient()
    return OpenRouterClient(api_key=get_api_key())


@asynccontextmanager
async def lifespan_client():
    """Manage a shared OpenRouterClient across the app lifespan."""
    global _client
    _client = _build_client()
    yield
    await _client.close()
    _client = None


def get_client() -> OpenRouterClient:
    """FastAPI dependency: return the shared OpenRouterClient."""
    if _client is None:
        raise RuntimeError("OpenRouterClient not initialized")
    return _client
