"""Suggest work from what the user ticked (the client's call, 4 Nov).

A thin shell over `promptmaster.personalization`. The browser reads the user's account
itself and sends only what they ticked, so no provider token ever reaches this server
and nothing here is stored. A check-like call, not a writer: it takes no `web_access`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.personalization import (
    MAX_ITEMS_CHARS,
    CatalogEntry,
    WorkflowSuggestions,
    suggest_workflows,
)
from promptmaster.schemas import ThirdPartyItem
from routers._errors import llm_http_error
from routers.stage import _model_used

router = APIRouter(prefix="/api", tags=["personalize"])


class SuggestWorkflowsRequest(BaseModel):
    items: list[ThirdPartyItem] = Field(min_length=1, max_length=20)
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
        raise HTTPException(status_code=422, detail="That is more text than a suggestion needs. Untick some items and try again.")
    try:
        result = await suggest_workflows(client, req.model or None, req.items, req.catalog, req.profile)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return SuggestWorkflowsResponse(**result.model_dump(), model_used=_model_used(req.model, client))
