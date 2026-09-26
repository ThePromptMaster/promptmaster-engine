"""Smart Setup endpoint — recommends mode/audience/constraints/format from an objective."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import GuideAnswer, GuideQuestion, SetupSuggestion
from promptmaster.setup_suggester import suggest_guide_questions, suggest_setup

router = APIRouter(prefix="/api", tags=["setup"])


class GenerateSetupRequest(BaseModel):
    objective: str
    model: str = ""
    #: Answers from the "Guide me" path; empty on "I know what I want to do".
    answers: list[GuideAnswer] = Field(default=[], max_length=8)


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
            answers=req.answers or None,
        )
        return GenerateSetupResponse(suggestion=suggestion)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


class GuideQuestionsRequest(BaseModel):
    objective: str = Field(..., min_length=1, max_length=4_000)
    model: str = ""


class GuideQuestionsResponse(BaseModel):
    questions: list[GuideQuestion]


@router.post("/guide-questions")
async def api_guide_questions(
    req: GuideQuestionsRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GuideQuestionsResponse:
    """PM-09 "Guide me": a few questions before recommending a setup. 1 LLM call."""
    questions = await suggest_guide_questions(client=client, model=req.model or None, objective=req.objective)
    return GuideQuestionsResponse(questions=questions)
