"""Smart Setup endpoint — recommends mode/audience/constraints/format from an objective."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import SetupSuggestion
from promptmaster.setup_suggester import suggest_setup

router = APIRouter(prefix="/api", tags=["setup"])


class GenerateSetupRequest(BaseModel):
    objective: str
    model: str = ""


class GenerateSetupResponse(BaseModel):
    suggestion: SetupSuggestion


@router.post("/generate-setup")
async def api_generate_setup(
    req: GenerateSetupRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GenerateSetupResponse:
    """Recommend a setup from the user's objective. 1 LLM call."""
    try:
        suggestion = await suggest_setup(
            client=client,
            model=req.model or None,
            objective=req.objective,
        )
        return GenerateSetupResponse(suggestion=suggestion)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
