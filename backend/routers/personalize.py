"""Suggest work from what someone tells us (the client's call, 4 Nov).

A thin shell over `promptmaster.personalization`. It reads no account itself and
stores nothing; items from a connected account (7 Nov) arrive already read and
ticked, through `/api/connections/read`. A check-like call, not a writer: it takes no `web_access`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.personalization import (
    MAX_ITEMS,
    MAX_ITEMS_CHARS,
    SUGGEST_MODEL,
    CatalogEntry,
    SharedItem,
    WorkflowSuggestions,
    suggest_workflows,
)
from routers._errors import llm_http_error

router = APIRouter(prefix="/api", tags=["personalize"])


class SuggestWorkflowsRequest(BaseModel):
    items: list[SharedItem] = Field(min_length=1, max_length=MAX_ITEMS)
    catalog: list[CatalogEntry] = Field(default_factory=list, max_length=40)
    profile: dict[str, str] = Field(default_factory=dict, max_length=6)
    model: str = ""


class SuggestWorkflowsResponse(WorkflowSuggestions):
    model_used: str = ""


@router.post("/suggest-workflows")
async def api_suggest_workflows(
    req: SuggestWorkflowsRequest,
    client: OpenRouterClient = Depends(get_client),
) -> SuggestWorkflowsResponse:
    """Up to three pieces of work, each traced to the items it came from. 1 LLM call."""
    if sum(len(i.text) + len(i.title) for i in req.items) > MAX_ITEMS_CHARS:
        raise HTTPException(status_code=422, detail="That is more text than a suggestion needs. Remove a file or shorten the note.")
    model = req.model or SUGGEST_MODEL
    try:
        result = await suggest_workflows(client, model, req.items, req.catalog, req.profile)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return SuggestWorkflowsResponse(**result.model_dump(), model_used=model)
