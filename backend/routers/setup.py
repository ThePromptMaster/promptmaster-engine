"""Smart Setup endpoint — recommends mode/audience/constraints/format from an objective."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.limits import MAX_CHAT_MESSAGE_CHARS, MAX_CONTEXT_CHARS, MAX_OBJECTIVE_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from routers._errors import llm_http_error
from promptmaster.schemas import GuideAnswer, GuideQuestion, PMInput, SavedSource, SetupSuggestion, WebUse
from promptmaster import web_search
from promptmaster.workflow_designer import DesignedWorkflow, design_workflow
from promptmaster.workflow_revision import RevisedWorkflow, revise_workflow
from promptmaster.front_door import BRIEF_FIELDS, DraftBrief, FrontDoorTurn, Turn, front_door_turn
from promptmaster.setup_suggester import MAX_GUIDE_QUESTIONS, suggest_guide_questions, suggest_next_guide_question, suggest_setup

router = APIRouter(prefix="/api", tags=["setup"])


class GenerateSetupRequest(BaseModel):
    objective: str = Field(..., min_length=1, max_length=MAX_OBJECTIVE_CHARS)
    model: str = ""
    #: Answers from the "Guide me" path; empty on "I know what I want to do".
    answers: list[GuideAnswer] = Field(default=[], max_length=8)
    #: What the user attached on the start screen, as text (5 Oct, email 8).
    material: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    #: The new project's Web access (22 Oct): on, the setup may not say there is no web.
    web_access: Literal["on", "off"] = "off"


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
            web_access=req.web_access,
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
    #: The simple start asks fewer (Sean, 18 Oct, email 7); never more than the server's own limit.
    max_questions: int = Field(default=MAX_GUIDE_QUESTIONS, ge=1, le=MAX_GUIDE_QUESTIONS)
    #: The new project's Web access (Sean, 22 Oct: "it probably needs to be
    #: added to the 'ask me questions' button too").
    web_access: Literal["on", "off"] = "off"
    #: What this intake's searches have found so far; a new search's sources follow them.
    sources: list[SavedSource] = Field(default=[], max_length=60)


class GuideNextResponse(WebUse):
    #: True when no further question is worth asking; `question` is then null.
    enough: bool
    question: GuideQuestion | None = None
    reason: str = ""


def _guide_task(req: GuideNextRequest) -> str:
    answers = "; ".join(f"{a.question} — {a.answer or '(skipped)'}" for a in req.answered)
    return (
        "Ask the user the next question for setting this work up, with example answers that reflect "
        f"current options and facts. The work: {req.objective}" + (f"\nAnswered so far: {answers}" if answers else "")
    )


@router.post("/guide-next-question")
async def api_guide_next_question(
    req: GuideNextRequest,
    client: OpenRouterClient = Depends(get_client),
) -> GuideNextResponse:
    """"Guide me", one question at a time: the next question given the answers
    so far, or that there is enough. 1 small LLM call; none past six answers.
    With Web access on, a question that needs current outside facts is
    searched first (as every writer is, L-100); the browser keeps what was found."""
    web = WebUse()
    found = ""
    if req.web_access == "on" and len(req.answered) < req.max_questions:
        inputs = PMInput(objective=req.objective[:4_000], mode="analyst", sources=req.sources)
        inputs, web = await web_search.with_web(client, req.model or None, inputs, "on", _guide_task(req))
        if web.web_sources:
            found = "\n".join(
                [web_search.FOUND_HEADER, f"SEARCHED FOR: {web.web_query}"]
                + [f"- {s.title or s.url} — {s.url}" + (f"\n  {s.excerpt}" if s.excerpt else "") for s in web.web_sources]
            )
    enough, question, reason = await suggest_next_guide_question(
        client=client, model=req.model or None, objective=req.objective,
        answered=[a.model_dump() for a in req.answered],
        material=req.material,
        limit=req.max_questions,
        found=found,
    )
    return GuideNextResponse(enough=enough, question=question, reason=reason, **web.model_dump())


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


class ReviseWorkflowRequest(BaseModel):
    workflow: DesignedWorkflow
    #: The change, in the user's words ("add a verification stage after Analysis").
    request: str = Field(..., min_length=3, max_length=MAX_CHAT_MESSAGE_CHARS)
    model: str = ""


@router.post("/revise-workflow")
async def api_revise_workflow(
    req: ReviseWorkflowRequest,
    client: OpenRouterClient = Depends(get_client),
) -> RevisedWorkflow:
    """A targeted change to a designed workflow: the stages it names change, the
    rest stay as they were, and what the engine cannot do is said (6 Oct,
    email 11). 1 LLM call; saves nothing."""
    try:
        return await revise_workflow(client, req.model or None, req.workflow, req.request)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


class FrontDoorRequest(BaseModel):
    turns: list[Turn] = Field(..., min_length=1, max_length=80)
    brief: DraftBrief = Field(default_factory=DraftBrief)
    model: str = ""
    #: Parts of the outline the user edited themselves (14 Oct call); kept as written.
    edited: list[str] = Field(default=[], max_length=len(BRIEF_FIELDS))
    #: What the user attached on the start screen, as text.
    material: str = Field(default="", max_length=MAX_CONTEXT_CHARS)
    #: Web access for the conversation (22 Oct). A new project has it on, so
    #: the start screen sends "on"; a caller that sends nothing gets no search.
    web_access: Literal["on", "off"] = "off"
    #: What this conversation's searches have found so far, numbered [S1]… in
    #: this order: a new search's sources follow them.
    sources: list[SavedSource] = Field(default=[], max_length=60)


@router.post("/front-door")
async def api_front_door(req: FrontDoorRequest, client: OpenRouterClient = Depends(get_client)) -> FrontDoorTurn:
    """One turn of talking a project into shape: a reply, and the draft brief as
    it stands (6 Oct, email 8). 1 LLM call, or 3 when Web access is on and the
    turn needs a search (22 Oct); saves nothing."""
    try:
        return await front_door_turn(
            client, req.model or None, req.turns, req.brief, req.edited, req.material, req.web_access, req.sources
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
