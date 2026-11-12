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

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from promptmaster.deliverable_check import MAX_TABLES, AcceptedFinding, DeliverableCheck, RecordedTable, check_deliverable, MAX_NOTE_QUOTES
from promptmaster.web_search import WebAccess, WebUse, cite_only_known, with_web
from deps import get_client, llm_mode
from promptmaster.literature import MAX_SEARCH_RESULTS, MAX_WORKS, WorkMatch, WorkQuery, lookup_works, search_works
from promptmaster.agent import (
    AgentState,
    EarlierRun,
    NextAction,
    TriageDecision,
    TriageStatus,
    choose_next_action,
    interpret_result,
    perform_reason,
    triage_findings,
    write_code,
)
from promptmaster.web_search import MAX_RESULTS as MAX_WEB_RESULTS, WebSearchResult, decide_work_search, own_words, search_web
from promptmaster.verify_sources import MAX_VERIFY, SourceToVerify, SourceVerdict, verify_sources
from promptmaster.criterion_check import CriterionCheck, check_criterion
from promptmaster.measured import MAX_LINES as MAX_MEASURED, MeasuredLine
from promptmaster.answer_check import CheckAnswerRequest, CheckAnswerResponse, check_answer
from promptmaster.question_screen import ScreenQuestionRequest, ScreenQuestionResponse, screen_question
from promptmaster.decision_options import DecisionOptionsRequest, DecisionOptionsResponse, decision_options
from promptmaster.settled_items import SettlesRequest, SettlesResponse, settled_items
from promptmaster.question_groups import GroupQuestionsRequest, GroupQuestionsResponse, group_questions
from promptmaster.objective_assessment import ObjectiveAssessment, RunStep, assess_objective
from promptmaster.expert_review import ExpertPackage, RecordDocument, prepare_expert_package
from promptmaster.fact_extraction import ExtractedFact, SourceDoc, extract_facts
from promptmaster.agent_actions import ACTION_KEYS, AGENT_ACTIONS, REASONING_ACTIONS, AgentAction
from promptmaster.errors import PRESERVED_NOTHING_WRITTEN
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.schemas import DataFileBrief, PMInput
from routers._errors import llm_http_error
from routers.stage import _model_used

logger = logging.getLogger(__name__)

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
    #: The project's Web access switch (22 Oct): on, this searches the web
    #: first when the work needs outside facts.
    web_access: WebAccess = "off"


class TextResponse(WebUse):
    text: str
    model_used: str = ""
    usage: Usage = Usage()


@router.post("/reason")
async def api_reason(req: ReasonRequest, client: OpenRouterClient = Depends(get_client)) -> TextResponse:
    """Perform a reasoning move. Its honest label is 'discussed' — nothing ran."""
    if req.action_key not in REASONING_ACTIONS:
        raise HTTPException(status_code=422, detail=f"'{req.action_key}' is not a reasoning action")
    try:
        inputs, web = await with_web(
            client, req.model or None, req.inputs, req.web_access,
            task=f"{req.action_key.replace('_', ' ')}: {req.params}"[:2_000],
            current="",
            # The planner wrote the params, having seen the items' titles.
            task_if_held=req.action_key.replace("_", " "),
        )
        text, usage = await perform_reason(
            client, req.model or None, inputs, req.state, req.action_key, req.params
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return TextResponse(text=cite_only_known(text, inputs, web), model_used=_model_used(req.model, client), usage=_usage(usage), **dict(web))


class WriteCodeRequest(BaseModel):
    inputs: PMInput
    state: AgentState
    #: Up to 40k: a check of a deliverable's code carries the code (M3).
    goal: str = Field(default="", max_length=40_000)
    kind: Literal["computation", "simulation"] = "computation"
    model: str = ""
    #: What the project's recent clean runs printed, newest first.
    earlier_runs: list[EarlierRun] = Field(default_factory=list, max_length=10)


class WriteCodeResponse(BaseModel):
    code: str
    language: Literal["python"] = "python"
    model_used: str = ""
    usage: Usage = Usage()


@router.post("/write-code")
async def api_write_code(req: WriteCodeRequest, client: OpenRouterClient = Depends(get_client)) -> WriteCodeResponse:
    """Write code for a computation. It is not run here; label 'code_written'."""
    try:
        code, usage = await write_code(client, req.model or None, req.inputs, req.state, req.goal, req.kind, req.earlier_runs)
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


class WebSearchRequest(BaseModel):
    inputs: PMInput
    query: str = Field(min_length=2, max_length=400)
    purpose: str = Field(default="", max_length=600)
    #: The project's "Web access" switch, as the browser read it. Off refuses.
    web_access: Literal["on", "off"] = "off"
    max_results: int = Field(default=MAX_WEB_RESULTS, ge=1, le=10)
    model: str = ""
    #: Who wrote the query: the user, in the Web sources box, or Go's planner.
    asked_by: Literal["user", "go"] = "go"
    #: The stage Go is on, by its label: what a query is written for while the
    #: project holds items other people wrote.
    stage: str = Field(default="", max_length=200)


class WebSearchResponse(WebSearchResult):
    model_used: str = ""
    #: What was searched for, when it was not the query sent (L-200).
    query_used: str = ""


@router.post("/web-search")
async def api_web_search(req: WebSearchRequest, client: OpenRouterClient = Depends(get_client)) -> WebSearchResponse:
    """Search the public web for this project (20 Oct): a summary and the
    search's own sources, for the browser to save. 1 model call with the web
    plugin; nothing stored here. Refused unless the project's switch is on."""
    if req.web_access != "on":
        raise HTTPException(status_code=403, detail="Web access is off for this project. Turn it on to search the web.")
    model = req.model or None
    inputs, query, purpose = own_words(req.inputs), req.query, req.purpose
    try:
        if req.inputs.third_party and req.asked_by == "go":
            # Go's planner saw the items' titles and the draft, so its query is not
            # used while the project holds them (7 Nov, the middle option; L-200):
            # one is written here from the user's own words.
            purpose = f"Public facts the stage \"{req.stage}\" needs" if req.stage.strip() else "Public facts the project needs"
            written = await decide_work_search(client, model, inputs, purpose)
            if not written:
                return WebSearchResponse(summary="No web search was needed for this project's own question.", model_used=_model_used(req.model, client))
            query = written
        result = await search_web(client, model, inputs, query, purpose, req.max_results)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return WebSearchResponse(
        **result.model_dump(), model_used=_model_used(req.model, client), query_used=query if query != req.query else ""
    )


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
    #: What code counted on the stage (4 Nov): reported, never estimated.
    measured: list[MeasuredLine] = Field(default_factory=list, max_length=MAX_MEASURED)
    #: The stage is a findings table whose accepted rows are carried out later (4 Nov).
    findings_table: bool = False
    model: str = ""


class CheckCriterionResponse(CriterionCheck):
    model_used: str = ""


@router.post("/check-criterion")
async def api_check_criterion(req: CheckCriterionRequest, client: OpenRouterClient = Depends(get_client)) -> CheckCriterionResponse:
    """Whether a stage's text satisfies a routine approval, before Go commits it
    under the routine-decision policy (5 Oct). 1 small LLM call; commits nothing."""
    try:
        result = await check_criterion(client, req.model or None, req.inputs, req.stage_label, req.criterion, req.content, req.measured, req.findings_table)
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
    #: Requirements code measured and found met, with the count (11 Oct).
    measured: list[str] = Field(default_factory=list, max_length=30)
    #: Earlier versions the deliverable names ("Check v18"), with their rows' decisions (19 Oct, HARBOR).
    history: list[str] = Field(default_factory=list, max_length=60)
    #: Each stage's label and how many versions it has saved.
    known_versions: dict[str, int] = Field(default_factory=dict, max_length=60)
    #: A round check: the stage that writes the deliverable next.
    later_stage: str = Field(default="", max_length=200)
    #: The project's data files, by name and columns (25 Oct, churn research).
    data_files: list[DataFileBrief] = Field(default_factory=list, max_length=20)
    model: str = ""


class AssessObjectiveResponse(ObjectiveAssessment):
    model_used: str = ""


def _line(text: str, limit: int = 600) -> str:
    """A check as one line, cut with a visible "…" — a silent cut read as a
    requirement truncated (12 Oct, Northstar)."""
    one = " ".join(text.split())
    return one if len(one) <= limit else one[: limit - 1].rstrip() + "…"


@router.post("/assess-objective")
async def api_assess_objective(req: AssessObjectiveRequest, client: OpenRouterClient = Depends(get_client)) -> AssessObjectiveResponse:
    """Whether the objective is met by what the project holds, before Go may say
    so (6 Oct, email 13). 1 LLM call; commits nothing."""
    try:
        result = await assess_objective(
            client, req.model or None, req.inputs, req.deliverable_label, req.content, req.steps, req.success_criterion,
            [_line(c) for c in req.failed_checks if c.strip()],
            [_line(m) for m in req.measured if m.strip()],
            [h[:4_000] for h in req.history if h.strip()],
            req.known_versions,
            req.later_stage,
            req.data_files,
        )
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return AssessObjectiveResponse(**result.model_dump(), model_used=_model_used(req.model, client))


class CheckDeliverableRequest(BaseModel):
    inputs: PMInput
    deliverable_label: str = Field(default="", max_length=200)
    content: str = Field(min_length=1, max_length=1_000_000)
    accepted: list[AcceptedFinding] = Field(default_factory=list, max_length=60)
    #: Outcome tables before the deliverable, as their rows stand (4 Nov).
    tables: list[RecordedTable] = Field(default_factory=list, max_length=MAX_TABLES)
    #: Passages the document's own review note quotes that the rest of it does not hold (5 Nov).
    note_quotes: list[str] = Field(default_factory=list, max_length=MAX_NOTE_QUOTES)
    #: What code counted on the deliverable (12 Nov): its length is judged from these, never by eye.
    measured: list[MeasuredLine] = Field(default_factory=list, max_length=MAX_MEASURED)
    model: str = ""


class CheckDeliverableResponse(DeliverableCheck):
    model_used: str = ""


@router.post("/check-deliverable")
async def api_check_deliverable(req: CheckDeliverableRequest, client: OpenRouterClient = Depends(get_client)) -> CheckDeliverableResponse:
    """Whether the deliverable carries the accepted findings and holds together
    (1 Nov). 1 LLM call; a check — writes nothing, never searches the web."""
    try:
        result = await check_deliverable(client, req.model or None, req.inputs, req.deliverable_label or "the deliverable", req.content, req.accepted, req.tables, req.note_quotes, req.measured)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return CheckDeliverableResponse(**result.model_dump(), model_used=_model_used(req.model, client))


class ExpertPackageRequest(BaseModel):
    inputs: PMInput
    issue: str = Field(min_length=1, max_length=2_000)
    stage_label: str = Field(default="", max_length=200)
    documents: list[RecordDocument] = Field(default_factory=list, max_length=30)
    model: str = ""
    #: The project's Web access switch (22 Oct): on, this searches the web
    #: first when the work needs outside facts.
    web_access: WebAccess = "off"


class ExpertPackageResponse(ExpertPackage, WebUse):
    model_used: str = ""


@router.post("/expert-package")
async def api_expert_package(req: ExpertPackageRequest, client: OpenRouterClient = Depends(get_client)) -> ExpertPackageResponse:
    """The package for an expert's judgment (Q3a; Sean, 9 Oct): question, assumptions,
    the saved working, evidence, what is unresolved and the judgment requested.
    1 LLM call; commits nothing — the client saves it."""
    try:
        inputs, web = await with_web(
            client, req.model or None, req.inputs, req.web_access,
            task=req.issue,
            current="",
            task_if_held=f"An expert's judgment for {req.stage_label or 'this project'}",
        )
        result = await prepare_expert_package(client, req.model or None, inputs, req.issue, req.stage_label, req.documents)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_NOTHING_WRITTEN)
    return ExpertPackageResponse(**result.model_dump(), model_used=_model_used(req.model, client), **dict(web))


@router.post("/screen-question", response_model=ScreenQuestionResponse)
async def api_screen_question(req: ScreenQuestionRequest, client: OpenRouterClient = Depends(get_client)) -> ScreenQuestionResponse:
    """Does the question Go wants to ask really need the user? 1 small LLM call;
    commits nothing. Any failure answers "ask", so a decision is never taken away."""
    try:
        return await screen_question(client, req)
    except Exception:  # noqa: BLE001 - the safe answer to any failure here is to ask
        logger.warning("Question screen failed; the question will be asked", exc_info=True)
        return ScreenQuestionResponse(reason="The screen could not run, so the question is asked.")


@router.post("/decision-options", response_model=DecisionOptionsResponse)
async def api_decision_options(req: DecisionOptionsRequest, client: OpenRouterClient = Depends(get_client)) -> DecisionOptionsResponse:
    """The options a stage puts to the user for one approval, each with the passage
    that states it (12 Nov). 1 small LLM call; commits nothing. Any failure answers
    with none, so the page falls back to the plain approval and nothing is invented."""
    try:
        return await decision_options(client, req)
    except Exception:  # noqa: BLE001 - no options is the safe answer to any failure here
        logger.warning("Decision options could not be read; the plain approval is shown", exc_info=True)
        return DecisionOptionsResponse()


@router.post("/group-questions", response_model=GroupQuestionsResponse)
async def api_group_questions(req: GroupQuestionsRequest, client: OpenRouterClient = Depends(get_client)) -> GroupQuestionsResponse:
    """Which of the things waiting on the user one answer would settle together, each
    group with the one question to ask (12 Nov). 1 small LLM call; commits nothing.
    Any failure groups nothing, so the items are asked one by one."""
    try:
        return await group_questions(client, req)
    except Exception:  # noqa: BLE001 - asking one by one is the safe answer to any failure here
        logger.warning("Question grouping failed; the items are asked one by one", exc_info=True)
        return GroupQuestionsResponse()


@router.post("/settles", response_model=SettlesResponse)
async def api_settles(req: SettlesRequest, client: OpenRouterClient = Depends(get_client)) -> SettlesResponse:
    """Which open findings the user's own words have settled: the note on the finding,
    or a fact or decision they stated (12 Nov). 1 small LLM call; commits nothing, and
    the browser marks the rows. Any failure settles nothing, so the finding stays open."""
    try:
        return await settled_items(client, req)
    except Exception:  # noqa: BLE001 - "still open" is the safe answer to any failure here
        logger.warning("Settled-items check failed; the findings stay open", exc_info=True)
        return SettlesResponse()


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
