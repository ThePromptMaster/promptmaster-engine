"""Go mode's model calls (PM-17, PM-19). Thin HTTP shells over promptmaster/agent.py.

The loop runs in the browser and persists every step itself (B4); these
endpoints hold no state, like every other router here. What they add is the
contract the client can rely on:

  - next-action returns an action from the allowed list, or a question — never
    an invented action;
  - write-code returns code and nothing claiming to be its output;
  - interpret-result only ever sees output that really came back from a run.

None of them can move a stage. That happens through workflow_events, under the
agent_run authorization the database checks (B1).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from deps import get_client, llm_mode
from promptmaster.literature import MAX_SEARCH_RESULTS, MAX_WORKS, WorkMatch, WorkQuery, lookup_works, search_works
from promptmaster.agent import (
    AgentState,
    NextAction,
    TriageDecision,
    TriageStatus,
    choose_next_action,
    interpret_result,
    perform_reason,
    triage_findings,
    write_code,
)
from promptmaster.verify_sources import MAX_VERIFY, SourceToVerify, SourceVerdict, verify_sources
from promptmaster.criterion_check import CriterionCheck, check_criterion
from promptmaster.answer_check import CheckAnswerRequest, CheckAnswerResponse, check_answer
from promptmaster.objective_assessment import ObjectiveAssessment, RunStep, assess_objective
from promptmaster.fact_extraction import ExtractedFact, SourceDoc, extract_facts
from promptmaster.agent_actions import ACTION_KEYS, AGENT_ACTIONS, REASONING_ACTIONS, AgentAction
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import PMInput
from routers._errors import llm_http_error
from routers.stage import _model_used

router = APIRouter(prefix="/api/agent", tags=["agent"])

Policy = Literal["guided", "checkpoint", "autonomous"]


class Usage(BaseModel):
    tokens_in: int = 0
    tokens_out: int = 0


def _usage(raw: dict[str, int]) -> Usage:
    return Usage(tokens_in=raw.get("tokens_in", 0), tokens_out=raw.get("tokens_out", 0))


@router.get("/actions")
async def api_agent_actions() -> list[AgentAction]:
    """The registry, so the client can check its mirror at runtime too."""
    return AGENT_ACTIONS


class NextActionRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    allowed_actions: list[str] = Field(min_length=1)
    policy: Policy = "guided"
    model: str = ""


class NextActionResponse(NextAction):
    model_used: str = ""


@router.post("/next-action")
async def api_next_action(
    req: NextActionRequest, client: OpenRouterClient = Depends(get_client)
) -> NextActionResponse:
    """Choose ONE next move. 1 LLM call (plus the JSON repair pass if needed)."""
    unknown = [k for k in req.allowed_actions if k not in ACTION_KEYS]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown actions: {', '.join(unknown)}")
    try:
        choice = await choose_next_action(
            client, req.model or None, req.inputs, req.state, req.allowed_actions, req.policy
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return NextActionResponse(**choice.model_dump(), model_used=_model_used(req.model, client))


class ReasonRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    action_key: str
    params: dict = Field(default_factory=dict)
    model: str = ""


class TextResponse(BaseModel):
    text: str
    model_used: str = ""
    usage: Usage = Usage()


@router.post("/reason")
async def api_reason(req: ReasonRequest, client: OpenRouterClient = Depends(get_client)) -> TextResponse:
    """Perform a reasoning move. Its honest label is 'discussed' — nothing ran."""
    if req.action_key not in REASONING_ACTIONS:
        raise HTTPException(status_code=422, detail=f"'{req.action_key}' is not a reasoning action")
    try:
        text, usage = await perform_reason(
            client, req.model or None, req.inputs, req.state, req.action_key, req.params
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return TextResponse(text=text, model_used=_model_used(req.model, client), usage=_usage(usage))


class WriteCodeRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    #: Up to 40k: a check of a deliverable's code carries the code (M3).
    goal: str = Field(default="", max_length=40_000)
    kind: Literal["computation", "simulation"] = "computation"
    model: str = ""


class WriteCodeResponse(BaseModel):
    code: str
    language: Literal["python"] = "python"
    model_used: str = ""
    usage: Usage = Usage()


@router.post("/write-code")
async def api_write_code(req: WriteCodeRequest, client: OpenRouterClient = Depends(get_client)) -> WriteCodeResponse:
    """Write code for a computation. It is not run here; label 'code_written'."""
    try:
        code, usage = await write_code(client, req.model or None, req.inputs, req.state, req.goal, req.kind)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    if not code.strip():
        raise HTTPException(status_code=502, detail="The model returned no code.")
    return WriteCodeResponse(code=code, model_used=_model_used(req.model, client), usage=_usage(usage))


class InterpretRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    #: The sandbox_runs row this interprets. The client passes it through to the
    #: step it records, where the database requires it (agent_steps_label_honest).
    sandbox_run_id: str
    code: str = Field(max_length=40_000)
    stdout: str = Field(default="", max_length=40_000)
    stderr: str = Field(default="", max_length=20_000)
    exit_code: int | None = None
    model: str = ""


@router.post("/interpret-result")
async def api_interpret_result(req: InterpretRequest, client: OpenRouterClient = Depends(get_client)) -> TextResponse:
    """Explain what a real execution printed. Label 'result_interpreted'."""
    try:
        text, usage = await interpret_result(
            client, req.model or None, req.inputs, req.state, req.code, req.stdout, req.stderr, req.exit_code
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return TextResponse(text=text, model_used=_model_used(req.model, client), usage=_usage(usage))


class TriageRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    #: The routine rows, each with its id and fields; never the ones kept for the user.
    items: list[dict] = Field(min_length=1, max_length=40)
    statuses: list[TriageStatus] = Field(min_length=1, max_length=8)
    model: str = ""
    #: "propose": a status for each row of a check table, which the user confirms (3 Oct).
    mode: Literal["triage", "propose"] = "triage"


class TriageResponse(BaseModel):
    decisions: list[TriageDecision]
    model_used: str = ""


@router.post("/triage")
async def api_triage(req: TriageRequest, client: OpenRouterClient = Depends(get_client)) -> TriageResponse:
    """Decide the routine findings of a review table (B3). 1 LLM call. The client
    applies the decisions to its rows; nothing is stored here."""
    try:
        decisions = await triage_findings(client, req.model or None, req.inputs, req.state, req.items, req.statuses, req.mode)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return TriageResponse(decisions=decisions, model_used=_model_used(req.model, client))


class LiteratureRequest(BaseModel):
    works: list[WorkQuery] = Field(min_length=1, max_length=MAX_WORKS)


class LiteratureResponse(BaseModel):
    matches: list[WorkMatch]
    source: str = "OpenAlex"


@router.post("/literature")
async def api_literature(req: LiteratureRequest) -> LiteratureResponse:
    """Look named works up in OpenAlex (1 Oct, item 12). No model call and
    nothing stored: for each work, whether a record with that title exists,
    and its real title, authors, year and DOI if it does."""
    return LiteratureResponse(matches=await lookup_works(req.works, mock=llm_mode() == "mock"))


class LiteratureSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=8, ge=1, le=MAX_SEARCH_RESULTS)


class LiteratureSearchResponse(BaseModel):
    works: list[WorkMatch]
    #: False when the index could not be reached: "nothing found" must not be read from an empty list then.
    reached: bool
    source: str = "OpenAlex"


@router.post("/literature-search")
async def api_literature_search(req: LiteratureSearchRequest) -> LiteratureSearchResponse:
    """Search OpenAlex by topic (2 Oct): the records it holds for these words,
    with their real titles, authors, years and DOIs. No model call and nothing
    stored. Nobody has read what is returned."""
    works, reached = await search_works(req.query, req.limit, mock=llm_mode() == "mock")
    return LiteratureSearchResponse(works=works, reached=reached)


class VerifySourcesRequest(BaseModel):
    inputs: PMInput
    sources: list[SourceToVerify] = Field(min_length=1, max_length=MAX_VERIFY)
    model: str = ""


class VerifySourcesResponse(BaseModel):
    verdicts: list[SourceVerdict]
    model_used: str = ""


@router.post("/verify-sources")
async def api_verify_sources(req: VerifySourcesRequest, client: OpenRouterClient = Depends(get_client)) -> VerifySourcesResponse:
    """Read each source's abstract in OpenAlex and judge whether it supports the
    row's claim, with the sentence relied on (5 Oct). One GET per source and at
    most one LLM call; nothing is stored."""
    try:
        verdicts = await verify_sources(client, req.model or None, req.inputs, req.sources, mock=llm_mode() == "mock")
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return VerifySourcesResponse(verdicts=verdicts, model_used=_model_used(req.model, client))


class CheckCriterionRequest(BaseModel):
    inputs: PMInput
    stage_label: str = Field(max_length=200)
    criterion: str = Field(min_length=1, max_length=400)
    content: str = Field(min_length=1, max_length=400_000)
    model: str = ""


class CheckCriterionResponse(CriterionCheck):
    model_used: str = ""


@router.post("/check-criterion")
async def api_check_criterion(req: CheckCriterionRequest, client: OpenRouterClient = Depends(get_client)) -> CheckCriterionResponse:
    """Whether a stage's text satisfies a routine approval, before Go commits it
    under the routine-decision policy (5 Oct). 1 small LLM call; commits nothing."""
    try:
        result = await check_criterion(client, req.model or None, req.inputs, req.stage_label, req.criterion, req.content)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return CheckCriterionResponse(**result.model_dump(), model_used=_model_used(req.model, client))


class AssessObjectiveRequest(BaseModel):
    inputs: PMInput
    deliverable_label: str = Field(max_length=200)
    content: str = Field(min_length=1, max_length=1_000_000)
    steps: list[RunStep] = Field(default_factory=list, max_length=40)
    success_criterion: str = Field(default="", max_length=4_000)
    #: What the project's own checks hold as still unmet (C2): measured
    #: requirements that fail, and review rows carried forward unresolved.
    failed_checks: list[str] = Field(default_factory=list, max_length=30)
    model: str = ""


class AssessObjectiveResponse(ObjectiveAssessment):
    model_used: str = ""


@router.post("/assess-objective")
async def api_assess_objective(req: AssessObjectiveRequest, client: OpenRouterClient = Depends(get_client)) -> AssessObjectiveResponse:
    """Whether the objective is met by what the project holds, before Go may say
    so (6 Oct, email 13). 1 LLM call; commits nothing."""
    try:
        result = await assess_objective(
            client, req.model or None, req.inputs, req.deliverable_label, req.content, req.steps, req.success_criterion,
            [" ".join(c.split())[:300] for c in req.failed_checks if c.strip()],
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return AssessObjectiveResponse(**result.model_dump(), model_used=_model_used(req.model, client))


@router.post("/check-answer")
async def api_check_answer(req: CheckAnswerRequest, client: OpenRouterClient = Depends(get_client)) -> CheckAnswerResponse:
    """Is a claim the answer makes about the saved record borne out by it (L-65)?
    1 small LLM call; commits nothing. A failed check reports no contradiction,
    so it never stands between the user and their answer."""
    return await check_answer(client, req)


class ExtractFactsRequest(BaseModel):
    inputs: PMInput
    sources: list[SourceDoc] = Field(default_factory=list, max_length=20)
    model: str = ""


class ExtractFactsResponse(BaseModel):
    facts: list[ExtractedFact]
    model_used: str = ""


@router.post("/extract-facts")
async def api_extract_facts(req: ExtractFactsRequest, client: OpenRouterClient = Depends(get_client)) -> ExtractFactsResponse:
    """The facts the attached documents state, each quoted from its source
    (7 Oct, L-51). 1 LLM call; records nothing — the browser does, under the
    routine-decision policy, and the database checks it."""
    try:
        facts = await extract_facts(client, req.model or None, req.inputs, req.sources)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return ExtractFactsResponse(facts=facts, model_used=_model_used(req.model, client))
