"""Go mode's planner and actors (PM-17, PM-19, PM-12).

Sean, Sep 10: "go" means "read the current state; determine the best expert
next move; actually perform that move; update the state; choose the next
move; continue until genuinely blocked or until a meaningful decision
requires me."

The loop itself runs in the browser (B4). This module holds the prompts for
its three model calls and nothing else, so each can be asserted on without a
model:

  next-action     choose ONE move from a closed list, with a rationale
  reason          perform a reasoning move (derive, prove, …) and show the work
  write-code      write code for a computation — code only, no results
  interpret       read a REAL execution's output; never invent numbers

Every prompt goes through the shared system prompt, so the self-model — and
its "never imply something was done that was only reasoned about" — reaches
all of them.
"""

from __future__ import annotations

import logging
import re

from pydantic import BaseModel, Field

from .agent_actions import ACTION_KEYS, ACTIONS_BY_KEY, AGENT_ACTIONS
from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .page_context import scrub_button_mentions
from .schemas import PMInput, DataFileBrief, format_data_files
from .project_context import context_block

logger = logging.getLogger(__name__)

POLICY_TEXT = {
    "guided": "GUIDED: you recommend one move; the user approves it before anything happens.",
    "checkpoint": (
        "CHECKPOINT: moves run automatically, but the run stops for the user at important "
        "decisions — moving stages, revising a draft, running code, changing assumptions."
    ),
    "autonomous": (
        "AUTONOMOUS: keep choosing and performing the best next move until the work is done, "
        "you are genuinely blocked, or a decision only the user can make is needed."
    ),
}


class AgentStepSummary(BaseModel):
    action_key: str
    status: str = ""
    execution_label: str | None = None
    output: str = Field(default="", max_length=4_000)


class AgentOutline(BaseModel):
    """The outline as it stands — its own artifact, invisible to the excerpt before B0."""
    sections: list[str] = Field(default_factory=list, max_length=60)
    named_count: int = 0
    approved: bool = False


class AgentManuscript(BaseModel):
    """The chapters, which live in artifacts.long_form rather than in a version.

    `own` is true on the long-form stage that writes them. On a stage after
    drafting that reads them — Continuity, Critique, Fact-check, Final review
    — it is false, `stage_label` names the stage that holds them and `excerpt`
    carries the opening of the text. Without that the planner on a review
    stage saw an empty stage and no data, and marked it stuck for a draft that
    existed (the client's 2 Oct screenshots).
    """
    total: int = 0
    complete: int = 0
    pending_jobs: int = 0
    written: list[str] = Field(default_factory=list, max_length=60)
    unwritten: list[str] = Field(default_factory=list, max_length=60)
    stage_label: str = Field(default="", max_length=200)
    words: int = 0
    own: bool = True
    #: The frontend's MANUSCRIPT_EXCERPT_CHARS (lib/agent/digest.ts); marker included.
    excerpt: str = Field(default="", max_length=6_000)


class AgentFindings(BaseModel):
    """A review stage's table and how much of it the user has decided on."""
    total: int = 0
    triaged: int = 0
    sample: list[str] = Field(default_factory=list, max_length=8)


class AgentWorkflowStage(BaseModel):
    label: str = Field(max_length=200)
    renderer: str = Field(default="", max_length=40)


class AgentWorkflow(BaseModel):
    """The workflow the project is on and its stages in order.

    Not knowing it, the planner spoke Research to a book — "paste the planned
    runs with their observed outcomes" on "Write a book about lions" — and was
    told the project held no data on a workflow with no stage that could run
    anything (2 Oct, screenshot 8). `has_data_stages`: some stage's table
    carries runs out, so a computation can serve it.
    """
    key: str = Field(max_length=40)
    label: str = Field(max_length=200)
    stages: list[AgentWorkflowStage] = Field(default_factory=list, max_length=40)
    has_data_stages: bool = False
    #: An investigation (template.inquiry): its objective may need a
    #: calculation, a source or data that no stage table carries.
    inquiry: bool = False
    #: Finite or ongoing, and what counts as done (7 Oct).
    execution: "WorkflowExecution | None" = None


class WorkflowExecution(BaseModel):
    kind: str = Field(default="finite", pattern="^(finite|ongoing)$")
    success_criterion: str = Field(default="", max_length=2_000)
    stop_conditions: list[str] = Field(default_factory=list, max_length=8)


AgentWorkflow.model_rebuild()


class AgentControl(BaseModel):
    """One button on the stage's page: its exact words, and where it is."""

    label: str = Field(max_length=200)
    where: str = Field(default="", max_length=200)


class AgentStageRef(BaseModel):
    """A stage named by its id and its label."""

    id: str = Field(max_length=100)
    label: str = Field(default="", max_length=200)


class AgentState(BaseModel):
    """What the planner may know. Assembled by the client from the project.

    Until B0 the planner saw only the stage's head version. On the Outline and
    long-form stages that is empty (the outline and the chapters are kept
    elsewhere), so it read "(empty — nothing drafted yet)" on a finished book
    and chose mark_blocked (Sean, 28 Sep, items 1 and 2, screenshot 3).
    """
    stage_id: str = ""
    stage_label: str = ""
    stage_instruction: str = ""
    #: The current stage's artifact, trimmed by the client.
    artifact_excerpt: str = Field(default="", max_length=12_000)
    criteria_met: list[str] = Field(default_factory=list)
    criteria_unmet: list[str] = Field(default_factory=list)
    evaluation: str = ""
    next_stage_label: str = ""
    prior_stages: list[str] = Field(default_factory=list)
    recent_steps: list[AgentStepSummary] = Field(default_factory=list, max_length=12)
    outline: AgentOutline | None = None
    manuscript: AgentManuscript | None = None
    findings: AgentFindings | None = None
    #: What the user has already decided on this project, from its own records.
    memory: list[str] = Field(default_factory=list, max_length=24)
    #: The project's data files, which code run in the sandbox can read at /data.
    data_files: list[DataFileBrief] = Field(default_factory=list, max_length=20)
    #: Tools the run can call; a move without its tool is not offered.
    tools: dict[str, bool] = Field(default_factory=dict)
    #: The buttons on the stage's page now, by their exact words (the frontend's
    #: `lib/workflow/stage-controls.ts`). None when the page is not known.
    controls: list[AgentControl] | None = Field(default=None, max_length=40)
    #: The workflow and its stages. None from a client that predates it.
    workflow: AgentWorkflow | None = None
    #: The earlier stages this stage may go back to (its template's allow_return_to), by label.
    return_targets: list[AgentStageRef] = Field(default_factory=list, max_length=12)


class NextAction(BaseModel):
    action_key: str
    params: dict = Field(default_factory=dict)
    rationale: str = ""
    expected_outcome: str = ""
    needs_user_decision: bool = False
    decision_question: str | None = None
    objective_complete: bool = False


_NEXT_ACTION_INSTRUCTION = (
    "GO MODE — CHOOSE THE NEXT MOVE. You are acting as the expert on this "
    "project. Read the state below and choose the single best next move: the one "
    "an expert in this field would make now to advance the objective. Prefer "
    "moves that do the work over moves that talk about it. Choose ONLY from the "
    "moves listed under MOVES AVAILABLE NOW; never invent one.\n\n"
    "If the objective is met and nothing needs another pass, choose "
    "declare_objective_complete and set objective_complete true — the objective, "
    "not the workflow: a final stage that says the success criterion is not met, "
    "or that work must pause for missing inputs, does not meet it. If a choice only "
    "the user can make is needed, choose request_user_decision and ask one "
    "specific question. If a missing tool or missing data stops you, and nothing "
    "listed can produce it, choose mark_blocked and say what is missing. Text that "
    "exists elsewhere in the project — the manuscript, the outline, an earlier "
    "stage's work — is not missing: a stage's own table being empty means it has "
    "not been drafted yet, and draft_stage drafts it from that text. Do not repeat "
    "a move that just failed or produced nothing new.\n\n"
    # Q3a (Sean, 9 Oct): "'ask a physicist' should identify a specific
    # technical issue … and which next actions depend on resolving it".
    "EXPERT JUDGMENT. When the next step needs a specialist's judgment the saved record "
    "cannot settle, first do any other useful work that does not depend on it. If you then "
    "must ask, ask with request_user_decision for an expert's judgment on the specific "
    "technical issue (say 'expert' and name the issue, the checks already made, and what "
    "waits on it) — never a general 'consult an expert'. Under routine decisions handled "
    "by you, you may also continue on a clearly labelled assumption ('Assumed, not "
    "verified: …'): results that rest on it are conditional, and never meet the objective.\n\n"
    "The workflow's order is a sensible default, not a rule. If the current stage "
    "may be skipped (propose_skip is listed) and an expert would not do it next for "
    "this particular objective, choose propose_skip and give the reason — do not "
    "work through a stage only because it comes next.\n\n"
    "Work that only the user can do on the page — approving, ticking a "
    "requirement, deciding rows, attaching data — is not missing data. If it is "
    "needed and no listed move does it, choose request_user_decision. Never "
    "mark_blocked for it: a blocked stage stops every later move too.\n\n"
    "BUTTONS. The state lists the buttons that are on the user's page now, "
    "under BUTTONS ON THIS PAGE NOW. You may name a button ONLY if it is in "
    "that list, in exactly those words, and when you do, also put those exact "
    "words in params.control. Never guess that a button exists, never write "
    "\"if your interface has\", and never name a button from memory or from "
    "another stage. If nothing in the list does what is needed, say so "
    "plainly — \"there is no button for this on this stage\" — and then "
    "either ask for the missing input (request_user_decision) or, when data "
    "or a tool is what is missing, choose mark_blocked and give the exact "
    "reason.\n\n"
    "Everything you write in rationale, expected_outcome and decision_question "
    "is shown to the user, who is not a developer. Write it in plain language "
    "about their work: say \"the draft\", \"the outline\", \"the table\", "
    "\"the sections\". Never use the words \"artifact\", \"action set\", "
    "\"allowed actions\", \"model call\", \"renderer\" or an action key; "
    "never describe your own menu of moves. Say what you will do, or what you "
    "need from them, and why.\n\n"
    "Return JSON only, in exactly this shape:\n"
    "{\n"
    '  "action_key": "one of the allowed keys",\n'
    '  "params": {},\n'
    '  "rationale": "one or two sentences: why this move, now",\n'
    '  "expected_outcome": "one sentence: what it should produce",\n'
    '  "needs_user_decision": false,\n'
    '  "decision_question": null,\n'
    '  "objective_complete": false\n'
    "}"
)


def _format_state(inputs: PMInput, state: AgentState) -> str:
    steps = "\n".join(
        f"- {s.action_key} → {s.status or '?'}"
        + (f" [{s.execution_label}]" if s.execution_label else "")
        + (f": {s.output.strip()[:300]}" if s.output.strip() else "")
        for s in state.recent_steps
    ) or "(none yet — this is the first move)"
    facts: list[str] = []
    if state.outline is not None:
        o = state.outline
        facts.append(
            f"OUTLINE: {o.named_count} named section(s), "
            + ("approved for drafting — approval is done; never ask the user to approve it again" if o.approved else "not yet approved")
            + (": " + "; ".join(o.sections[:20]) if o.sections else "")
        )
    manuscript_block: list[str] = []
    if state.manuscript is not None:
        m = state.manuscript
        where = (
            f" (drafted on {m.stage_label or 'the drafting stage'}; {m.words:,} words; this stage reads it)"
            if not m.own else ""
        )
        facts.append(
            f"MANUSCRIPT{where}: {m.complete} of {m.total} section(s) written"
            + (f", {m.pending_jobs} being written now" if m.pending_jobs else "")
            + (f"; written: {'; '.join(m.written[:20])}" if m.written else "")
            + (f"; still unwritten: {'; '.join(m.unwritten[:20])}" if m.unwritten else "")
        )
        if not m.own and m.excerpt.strip():
            manuscript_block = [
                "",
                "--- THE MANUSCRIPT THIS STAGE REVIEWS (the opening; the whole text goes to the draft) ---",
                m.excerpt.strip(),
                "--- END ---",
                "A review stage's table is produced FROM this manuscript: choose draft_stage "
                "to write it. The manuscript is not missing data; never mark_blocked because "
                "the stage's own table is empty.",
            ]
    if state.findings is not None:
        f = state.findings
        facts.append(
            f"FINDINGS: {f.total} in the table, {f.triaged} decided by the user, "
            f"{max(f.total - f.triaged, 0)} still undecided"
            + (": " + "; ".join(f.sample) if f.sample else "")
        )
    data = format_data_files(state.data_files)
    if data:
        facts.append(
            "DATA THE PROJECT HOLDS (readable by code you run, at these paths — you have not seen the contents):\n" + data
        )
    elif state.workflow is None or state.workflow.has_data_stages:
        # 9 Oct (Q1a): "none" read as "nothing can be computed", and a research
        # run left every calculation "not run". A computation from equations,
        # definitions or values the project states needs no dataset.
        facts.append(
            "DATA THE PROJECT HOLDS: none. A computation from equations, definitions or values the project "
            "states needs no dataset: run_computation can carry it out, with the code computing or simulating "
            "its own inputs. Only a computation that needs measured or recorded data cannot be run; then say "
            "exactly what data is missing."
        )
    elif state.workflow.inquiry:
        # An investigation designed as a custom workflow has no "runs" table,
        # but its objective may still need a calculation, a formula or a source.
        # Told "writing, never mark a stage stuck", Go wrote a research log that
        # said the criterion was not met and then declared the objective met
        # (6 Oct, email 13). Missing inputs are a blocker, named exactly.
        facts.append(
            "DATA THE PROJECT HOLDS: none. This is an investigation: if meeting the objective needs a "
            "calculation, a formula, a source or data the project does not hold, and no move listed can "
            "produce it, choose mark_blocked and name exactly what is missing — do not write around it."
        )
    else:
        # A writing workflow has no stage a computation serves. Told "no data",
        # the planner asked a book for experiment results.
        facts.append(
            f"DATA: this is a {state.workflow.label.lower()} workflow — writing, not computation. "
            "No stage of it needs a dataset, a run or a measurement; never ask the user for one "
            "and never mark a stage stuck for the lack of one. Code is different: where "
            "run_computation is among the moves, the draft holds code the objective asks to "
            "have checked — run it before saying the code is correct, and report what ran."
        )
    if state.return_targets:
        # Q2 (9 Oct): going back is a response to what the saved work found,
        # chosen for the problem — not a fixed loop back to Experiment.
        facts.append(
            "GO BACK TO (stages this one may return to, for return_to_stage — by stage_id): "
            + "; ".join(f"{t.id} ({t.label or t.id})" for t in state.return_targets)
            + ". Choose by what the saved work asks for: more runs or cases → the experiment stage; a "
            "different approach → the method stage; a missing source → the literature stage; another "
            "explanation → the alternatives stage. Going back is one response among others, not a reflex."
        )
    if state.controls is None:
        facts.append("BUTTONS ON THIS PAGE NOW: not known. Do not name any button.")
    elif state.controls:
        facts.append(
            "BUTTONS ON THIS PAGE NOW (the user presses these; you cannot — name one only in these exact words):\n"
            + "\n".join(f'- "{c.label}" — {c.where}' for c in state.controls)
        )
    else:
        facts.append("BUTTONS ON THIS PAGE NOW: none. Do not name any button.")
    if state.tools:
        facts.append("TOOLS: " + ", ".join(f"{k}={'yes' if v else 'no'}" for k, v in sorted(state.tools.items())))
    workflow_line = (
        [
            f"WORKFLOW: {state.workflow.label} — "
            + " › ".join(
                s.label + (" [chapters]" if s.renderer == "long_form" else " [review table]" if s.renderer == "review" else "")
                for s in state.workflow.stages
            )
        ]
        if state.workflow is not None and state.workflow.stages else []
    )
    ex = state.workflow.execution if state.workflow is not None else None
    if ex is not None and (ex.kind == "ongoing" or ex.success_criterion.strip()):
        # 7 Oct: the objective's own criterion, kept when the workflow was
        # designed; the last stage is not it (Sean, 6 Oct, email 10).
        workflow_line.append(
            f"EXECUTION: {'ongoing — rounds continue until the criterion is met or a stop condition holds' if ex.kind == 'ongoing' else 'finite'}."
            + (f" Done means: {ex.success_criterion.strip()}." if ex.success_criterion.strip() else "")
            + (f" Stop short of it when: {'; '.join(ex.stop_conditions)}." if ex.stop_conditions else "")
            + " Reaching the last stage does not by itself meet the objective."
        )
    return "\n".join([
        f"OBJECTIVE (authoritative): {inputs.objective}",
        f"Audience: {inputs.audience or '(not set)'}",
        f"Constraints: {inputs.constraints or '(none)'}",
        *([context_block(inputs, limit=4_000)] if (inputs.context.strip() or inputs.facts) else []),
        "",
        *workflow_line,
        f"CURRENT STAGE: {state.stage_label or state.stage_id}",
        f"What this stage asks for: {state.stage_instruction or '(no instruction)'}",
        f"Next stage: {state.next_stage_label or '(this is the last stage)'}",
        "Requirements met: " + ("; ".join(state.criteria_met) or "(none)"),
        "Requirements still open: " + ("; ".join(state.criteria_unmet) or "(none)"),
        f"Latest evaluation: {state.evaluation or '(not checked yet)'}",
        "Earlier stages: " + ("; ".join(state.prior_stages) or "(none)"),
        *(
            [
                "",
                "ALREADY DECIDED ON THIS PROJECT, by the user, earlier (possibly in an earlier "
                "session). Build on these. Do not ask again about something settled here, and do "
                "not go back on one without saying why:",
                *[f"- {line}" for line in state.memory],
                "",
            ]
            if state.memory else []
        ),
        *facts,
        "",
        "--- WHAT THIS STAGE HOLDS NOW (may be trimmed) ---",
        state.artifact_excerpt.strip() or "(nothing has been drafted on this stage yet)",
        "--- END ---",
        *manuscript_block,
        "",
        "Moves made so far in this run (oldest first):",
        steps,
    ])


def build_next_action_prompt(
    inputs: PMInput, state: AgentState, allowed: list[str], policy: str
) -> tuple[str, str]:
    """Build (system, user) for choosing the next move. Pure."""
    system = _shared_system(inputs, [], f"{_NEXT_ACTION_INSTRUCTION}\n\n{POLICY_TEXT.get(policy, POLICY_TEXT['guided'])}")
    menu = "\n".join(
        f"- {a.key}: {a.label}. {a.when}" for a in AGENT_ACTIONS if a.key in set(allowed)
    )
    user = f"{_format_state(inputs, state)}\n\nMOVES AVAILABLE NOW:\n{menu}\n\nChoose the next move."
    return system, user


#: The Go panel's own buttons, on every page Go runs on.
_GO_BUTTONS = ("Resume", "Stop", "Go")


def _named_control(params: dict, controls: list[AgentControl] | None) -> dict:
    """Keep `params.control` only when it is a button the page really has, in the
    page's own words; anything else the planner named is dropped."""
    if "control" not in params:
        return params
    named = str(params.get("control") or "").strip().lower()
    real = next((c.label for c in (controls or []) if c.label.strip().lower() == named), None)
    kept = {k: v for k, v in params.items() if k != "control"}
    if real:
        kept["control"] = real
    else:
        logger.warning(f"Planner named a button that is not on the page: {params.get('control')!r}")
    return kept


def parse_next_action(result: object, allowed: list[str], controls: list[AgentControl] | None = None) -> NextAction:
    """Validate the planner's choice. Anything outside the list becomes a question
    to the user rather than an invented action."""
    permitted = set(allowed) & ACTION_KEYS
    if not isinstance(result, dict):
        return _ask("I could not work out a next move from the current state. What should happen next?")
    key = str(result.get("action_key") or "")
    if key not in permitted:
        logger.warning(f"Planner chose {key!r}, outside the allowed actions; asking the user instead")
        return _ask("I could not settle on a next step that I can carry out from here. What would you like to do next?")
    params = _named_control(result.get("params") if isinstance(result.get("params"), dict) else {}, controls)
    question = result.get("decision_question")

    # The words around params.control are shown to the user too; a button
    # named there that the page lacks is rewritten (3 Oct: "Press Generate
    # Outline" on the Approval stage). Go's own Resume and Stop always exist.
    def shown(text: object) -> str:
        return scrub_button_mentions(str(text or "").strip(), controls, also=_GO_BUTTONS)

    return NextAction(
        action_key=key,
        params=params,
        rationale=shown(result.get("rationale")),
        expected_outcome=shown(result.get("expected_outcome")),
        needs_user_decision=bool(result.get("needs_user_decision")) or key == "request_user_decision",
        decision_question=shown(question) if question else None,
        objective_complete=bool(result.get("objective_complete")) or key == "declare_objective_complete",
    )


def _ask(question: str) -> NextAction:
    return NextAction(
        action_key="request_user_decision",
        rationale="The next move could not be chosen safely on its own.",
        needs_user_decision=True,
        decision_question=question,
    )


async def choose_next_action(
    client: OpenRouterClient, model: str | None, inputs: PMInput, state: AgentState,
    allowed: list[str], policy: str,
) -> NextAction:
    system, user = build_next_action_prompt(inputs, state, allowed, policy)
    result, _usage = await client.generate_json(
        prompt=user, system=system, temperature=0.2, max_tokens=900, model=model,
    )
    return parse_next_action(result, allowed, state.controls)


# --- performing a reasoning move --------------------------------------------------

_REASON_GUIDE = {
    "derive": "Derive the result step by step from what is already established. Show every step.",
    "prove": "Prove the claim. State what is assumed, then the argument, then what exactly is shown.",
    "simplify": "Reduce it to its essential form. Show what was removed and why that is safe.",
    "limiting_case": "Test the result at its limits and at known special cases. Say where it holds and where it does not.",
    "try_contradiction": "Assume the opposite and follow it. Say whether it breaks, and exactly where.",
    "falsify_hypothesis": "State precisely what observation or result would prove the hypothesis wrong, and whether the work so far rules it in or out.",
    "compare_alternatives": "Set the competing explanations side by side and weigh each against the evidence. Say which survives and why.",
    "update_assumptions": "Name the assumption that no longer holds, what replaces it, and what that changes downstream.",
}


def build_reason_prompt(
    inputs: PMInput, state: AgentState, action_key: str, params: dict
) -> tuple[str, str]:
    guide = _REASON_GUIDE.get(action_key, "Do this step carefully and show the work.")
    label = ACTIONS_BY_KEY[action_key].label if action_key in ACTIONS_BY_KEY else action_key
    system = _shared_system(inputs, [], (
        f"GO MODE — PERFORM: {label.upper()}. {guide} This is reasoning on the page: "
        "you are not running code, measuring or looking anything up, and you must not "
        "write as though you had. If a step needs a computation or data you do not "
        "have, say so plainly instead of estimating it. Return Markdown."
    ))
    focus = params.get("focus") or params.get("goal") or ""
    user = f"{_format_state(inputs, state)}\n\n{('Focus: ' + str(focus)) if focus else ''}\n\nPerform the move now."
    return system, user


# --- code: write, then (elsewhere) run, then interpret ------------------------------

_WRITE_CODE_INSTRUCTION = (
    "GO MODE — WRITE CODE. Write one self-contained Python 3 script that computes "
    "what is asked. Standard library, numpy, scipy, sympy, matplotlib and pandas "
    "are available; nothing else, and no network access. Print every result the "
    "reader needs on its own line as `label: value`, so each can be recorded. "
    "Save any plot to /out/<name>.png. "
    "DATA: the project's files, if any, are listed in the state below with their "
    "paths under /data, their columns and a few sample rows. Read them with "
    "pandas, or the csv or json modules. Use only files that "
    "are listed, by the exact path shown; never invent a file, a column or a "
    "value. If the goal needs data that is not listed, do not make data up and "
    "do not compute on placeholders: write a script that prints one line, "
    "`MISSING_DATA: <exactly what is missing, as one plain sentence>`, and then "
    "calls `raise SystemExit(2)`. That line is recorded as the reason the run "
    "was not made. Never report a run that could not be made as a `status:` "
    "line or as an ordinary result: a clean exit means the analysis was "
    "carried out, and the row is marked Completed. Return "
    "ONLY the code — no prose, no fences, and never any claimed output: the code "
    "has not been run, and you do not know what it will print."
)


def build_write_code_prompt(inputs: PMInput, state: AgentState, goal: str, kind: str) -> tuple[str, str]:
    system = _shared_system(inputs, [], _WRITE_CODE_INSTRUCTION)
    user = (
        f"{_format_state(inputs, state)}\n\n"
        f"Write code for this {'simulation' if kind == 'simulation' else 'computation'}: {goal or 'the next computation the work needs'}"
    )
    return system, user


_FENCE = re.compile(r"^```[a-zA-Z0-9]*\s*\n|\n?```\s*$")


def clean_code(text: str) -> str:
    """Strip a Markdown fence a model adds despite being told not to."""
    return _FENCE.sub("", text.strip()).strip()


_INTERPRET_INSTRUCTION = (
    "GO MODE — INTERPRET A RESULT. The code below WAS executed, and its real "
    "output is given. Say what the output shows for the objective, citing the "
    "printed values exactly as they appear. Never state a number that is not in "
    "the output. If it exited with an error, say what failed and what to change. "
    "If the output does not settle the question, say what would. Return Markdown."
)


def build_interpret_prompt(
    inputs: PMInput, state: AgentState, code: str, stdout: str, stderr: str, exit_code: int | None
) -> tuple[str, str]:
    system = _shared_system(inputs, [], _INTERPRET_INSTRUCTION)
    user = "\n".join([
        _format_state(inputs, state),
        "",
        "--- CODE THAT WAS RUN ---",
        code.strip(),
        "--- EXIT CODE ---",
        str(exit_code),
        "--- STDOUT ---",
        stdout.strip() or "(nothing printed)",
        "--- STDERR ---",
        stderr.strip() or "(empty)",
        "--- END ---",
        "",
        "Interpret the result.",
    ])
    return system, user


# --- the calls --------------------------------------------------------------------

async def perform_reason(
    client: OpenRouterClient, model: str | None, inputs: PMInput, state: AgentState,
    action_key: str, params: dict,
) -> tuple[str, dict[str, int]]:
    system, user = build_reason_prompt(inputs, state, action_key, params)
    return await client.generate(prompt=user, system=system, temperature=0.4, max_tokens=4000, model=model)


async def write_code(
    client: OpenRouterClient, model: str | None, inputs: PMInput, state: AgentState, goal: str, kind: str,
) -> tuple[str, dict[str, int]]:
    system, user = build_write_code_prompt(inputs, state, goal, kind)
    text, usage = await client.generate(prompt=user, system=system, temperature=0.2, max_tokens=4000, model=model)
    return clean_code(text), usage


async def interpret_result(
    client: OpenRouterClient, model: str | None, inputs: PMInput, state: AgentState,
    code: str, stdout: str, stderr: str, exit_code: int | None,
) -> tuple[str, dict[str, int]]:
    system, user = build_interpret_prompt(inputs, state, code, stdout, stderr, exit_code)
    return await client.generate(prompt=user, system=system, temperature=0.2, max_tokens=2500, model=model)


# --- deciding the routine findings of a review table (B3) ---------------------------

class TriageStatus(BaseModel):
    value: str
    label: str = ""
    requires_reason: bool = False


class TriageDecision(BaseModel):
    id: str
    status: str
    reason: str = ""


_TRIAGE_INSTRUCTION = (
    "GO MODE — DECIDE THE ROUTINE FINDINGS. Below are findings from a review of "
    "the work, each with an id. They are the routine ones (minor or moderate); "
    "the ones that would change the structure or the argument have been kept "
    "back for the user. For EACH id, choose exactly one of the statuses offered "
    "and give a one-sentence reason where the status demands one — a reason is "
    "what makes a deferral or rejection a decision rather than a shrug. Accept "
    "a finding that is right; reject one that is wrong about the text; defer one "
    "that is right but belongs to a later pass. Decide only the ids given; never "
    "invent one.\n\n"
    "Return JSON only, in exactly this shape:\n"
    "{\n"
    '  "decisions": [ {"id": "...", "status": "one of the statuses", "reason": "one sentence or empty"} ]\n'
    "}"
)


_PROPOSE_INSTRUCTION = (
    "PROPOSE A STATUS FOR EACH ROW. Below are the rows of a check table, each "
    "with an id, as the draft wrote them. For each id, propose the one status "
    "the row's OWN text supports, with a one-sentence reason in the row's own "
    "terms. The user will confirm or change every proposal, so choose what the "
    "text actually says was done or found — never a stronger status than it "
    "supports: a comparison with earlier work is not a reproduction, and "
    "'partly addressed' is not 'ruled out'. If a row's text does not settle "
    "it, leave that id out. Decide only the ids given; never invent one.\n\n"
    "Return JSON only, in exactly this shape:\n"
    "{\n"
    '  "decisions": [ {"id": "...", "status": "one of the statuses", "reason": "one sentence"} ]\n'
    "}"
)


def build_triage_prompt(
    inputs: PMInput, state: AgentState, items: list[dict], statuses: list[TriageStatus], mode: str = "triage"
) -> tuple[str, str]:
    """Build (system, user) for deciding routine findings, or proposing row statuses. Pure."""
    system = _shared_system(inputs, [], _PROPOSE_INSTRUCTION if mode == "propose" else _TRIAGE_INSTRUCTION)
    menu = "\n".join(
        f"- {s.value}: {s.label or s.value}" + (" (reason required)" if s.requires_reason else "")
        for s in statuses
    )
    rows = "\n".join(
        f"- id={item.get('id', '?')}: " + "; ".join(f"{k}: {v}" for k, v in item.items() if k != "id" and str(v).strip())
        for item in items
    ) or "(none)"
    if mode == "propose":
        user = f"{_format_state(inputs, state)}\n\nSTATUSES OFFERED:\n{menu}\n\nROWS:\n{rows}\n\nPropose a status for each row its text settles."
    else:
        user = f"{_format_state(inputs, state)}\n\nSTATUSES OFFERED:\n{menu}\n\nFINDINGS TO DECIDE:\n{rows}\n\nDecide each one."
    return system, user


def parse_triage(
    result: object, item_ids: set[str], statuses: list[TriageStatus], reason_always: bool = False
) -> list[TriageDecision]:
    """Keep only decisions for the ids given, with a status offered, and a reason where demanded
    (always, for a proposal: the reason is what the user confirms)."""
    if not isinstance(result, dict) or not isinstance(result.get("decisions"), list):
        return []
    by_value = {s.value: s for s in statuses}
    out: list[TriageDecision] = []
    seen: set[str] = set()
    for raw in result["decisions"]:
        if not isinstance(raw, dict):
            continue
        item_id = str(raw.get("id") or "")
        status = str(raw.get("status") or "").strip()
        reason = str(raw.get("reason") or "").strip()
        if item_id not in item_ids or item_id in seen or status not in by_value:
            continue
        if (reason_always or by_value[status].requires_reason) and not reason:
            continue
        seen.add(item_id)
        out.append(TriageDecision(id=item_id, status=status, reason=reason))
    return out


async def triage_findings(
    client: OpenRouterClient, model: str | None, inputs: PMInput, state: AgentState,
    items: list[dict], statuses: list[TriageStatus], mode: str = "triage",
) -> list[TriageDecision]:
    system, user = build_triage_prompt(inputs, state, items, statuses, mode)
    result, _usage = await client.generate_json(
        prompt=user, system=system, temperature=0.2, max_tokens=1_500, model=model,
    )
    return parse_triage(result, {str(i.get("id")) for i in items if i.get("id")}, statuses, reason_always=mode == "propose")
