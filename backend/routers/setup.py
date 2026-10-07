"""Smart Setup endpoint — recommends mode/audience/constraints/format from an objective."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.limits import MAX_CHAT_MESSAGE_CHARS, MAX_CONTEXT_CHARS, MAX_OBJECTIVE_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import GuideAnswer, GuideQuestion, SetupSuggestion
from promptmaster.workflow_designer import DesignedWorkflow, design_workflow
from promptmaster.setup_suggester import suggest_guide_questions, suggest_next_guide_question, suggest_setup

router = APIRouter(prefix="/api", tags=["setup"])


class GenerateSetupRequest(BaseModel):
    objective: str = Field(..., min_length=1, max_length=MAX_OBJECTIVE_CHARS)
    model: str = ""
    #: Answers from the "Guide me" path; empty on "I know what I want to do".
    answers: list[GuideAnswer] = Field(default=[], max_length=8)
    #: What the user attached on the start screen, as text (5 Oct, email 8).
    material: str = Field(default="", max_length=MAX_CONTEXT_CHARS)


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
            material=req.material,
        )
        return GenerateSetupResponse(suggestion=suggestion)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)


class GuideQuestionsRequest(BaseModel):
    objective: str = Field(..., min_length=1, max_length=MAX_OBJECTIVE_CHARS)
    model: str = ""
    material: str = Field(default="", max_length=MAX_CONTEXT_CHARS)


class GuideQuestionsResponse(BaseModel):
    questions: list[GuideQuestion]


@router.post("/guide-questions")
async def api_guide_questions(
    req: GuideQuestionsRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GuideQuestionsResponse:
    """PM-09 "Guide me": a few questions before recommending a setup. 1 LLM call."""
    questions = await suggest_guide_questions(
        client=client, model=req.model or None, objective=req.objective, material=req.material
    )
    return GuideQuestionsResponse(questions=questions)


class GuideAnswered(BaseModel):
    question: str = Field(max_length=2_000)
    answer: str = Field(default="", max_length=MAX_CHAT_MESSAGE_CHARS)


class GuideNextRequest(BaseModel):
    objective: str = Field(..., min_length=1, max_length=MAX_OBJECTIVE_CHARS)
    answered: list[GuideAnswered] = Field(default_factory=list, max_length=12)
    model: str = ""
    material: str = Field(default="", max_length=MAX_CONTEXT_CHARS)


class GuideNextResponse(BaseModel):
    #: True when no further question is worth asking; `question` is then null.
    enough: bool
    question: GuideQuestion | None = None
    reason: str = ""


@router.post("/guide-next-question")
async def api_guide_next_question(
    req: GuideNextRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GuideNextResponse:
    """"Guide me", one question at a time: the next question given the answers
    so far, or that there is enough. 1 small LLM call; none past six answers."""
    enough, question, reason = await suggest_next_guide_question(
        client=client, model=req.model or None, objective=req.objective,
        answered=[a.model_dump() for a in req.answered],
        material=req.material,
    )
    return GuideNextResponse(enough=enough, question=question, reason=reason)


class GenerateWorkflowRequest(BaseModel):
    #: What kind of work this is, in the user's words ("a magazine feature").
    description: str = Field(..., min_length=3, max_length=MAX_CHAT_MESSAGE_CHARS)
    objective: str = Field(default="", max_length=MAX_OBJECTIVE_CHARS)
    model: str = ""


class GenerateWorkflowResponse(BaseModel):
    workflow: DesignedWorkflow


@router.post("/generate-workflow")
async def api_generate_workflow(
    req: GenerateWorkflowRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GenerateWorkflowResponse:
    """Propose the stages of a workflow for this kind of work. 1 LLM call; saves nothing."""
    try:
        workflow = await design_workflow(client, req.model or None, req.description, req.objective)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return GenerateWorkflowResponse(workflow=workflow)
