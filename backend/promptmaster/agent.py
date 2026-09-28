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
from .schemas import PMInput

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
    """The chapters, which live in artifacts.long_form rather than in a version."""
    total: int = 0
    complete: int = 0
    pending_jobs: int = 0
    written: list[str] = Field(default_factory=list, max_length=60)
    unwritten: list[str] = Field(default_factory=list, max_length=60)


class AgentFindings(BaseModel):
    """A review stage's table and how much of it the user has decided on."""
    total: int = 0
    triaged: int = 0
    sample: list[str] = Field(default_factory=list, max_length=8)


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
    #: Tools the run can call; a move without its tool is not offered.
    tools: dict[str, bool] = Field(default_factory=dict)


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
    "allowed actions listed; never invent one.\n\n"
    "If the objective is met and nothing needs another pass, choose "
    "declare_objective_complete and set objective_complete true. If a choice only "
    "the user can make is needed, choose request_user_decision and ask one "
    "specific question. If a missing tool or missing data stops you, choose "
    "mark_blocked and say what is missing. Do not repeat a move that just "
    "failed or produced nothing new.\n\n"
    "Work that the stage's own controls do — generating or approving an outline, "
    "drafting or revising sections, deciding on findings — is not missing data: "
    "if it is needed and no allowed action does it, choose request_user_decision "
    "and name that control exactly (\"press Generate the outline\"). Never "
    "mark_blocked for it: a blocked stage stops every later move too.\n\n"
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
            + ("approved for drafting" if o.approved else "not yet approved")
            + (": " + "; ".join(o.sections[:20]) if o.sections else "")
        )
    if state.manuscript is not None:
        m = state.manuscript
        facts.append(
            f"MANUSCRIPT: {m.complete} of {m.total} section(s) written"
            + (f", {m.pending_jobs} being written now" if m.pending_jobs else "")
            + (f"; written: {'; '.join(m.written[:20])}" if m.written else "")
            + (f"; still unwritten: {'; '.join(m.unwritten[:20])}" if m.unwritten else "")
        )
    if state.findings is not None:
        f = state.findings
        facts.append(
            f"FINDINGS: {f.total} in the table, {f.triaged} decided by the user, "
            f"{max(f.total - f.triaged, 0)} still undecided"
            + (": " + "; ".join(f.sample) if f.sample else "")
        )
    if state.tools:
        facts.append("TOOLS: " + ", ".join(f"{k}={'yes' if v else 'no'}" for k, v in sorted(state.tools.items())))
    return "\n".join([
        f"OBJECTIVE (authoritative): {inputs.objective}",
        f"Audience: {inputs.audience or '(not set)'}",
        "",
        f"CURRENT STAGE: {state.stage_label or state.stage_id}",
        f"What this stage asks for: {state.stage_instruction or '(no instruction)'}",
        f"Next stage: {state.next_stage_label or '(this is the last stage)'}",
        "Requirements met: " + ("; ".join(state.criteria_met) or "(none)"),
        "Requirements still open: " + ("; ".join(state.criteria_unmet) or "(none)"),
        f"Latest evaluation: {state.evaluation or '(not checked yet)'}",
        "Earlier stages: " + ("; ".join(state.prior_stages) or "(none)"),
        *facts,
        "",
        "--- CURRENT STAGE ARTIFACT (may be trimmed) ---",
        state.artifact_excerpt.strip() or "(empty — nothing drafted yet)",
        "--- END ARTIFACT ---",
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
    user = f"{_format_state(inputs, state)}\n\nALLOWED ACTIONS:\n{menu}\n\nChoose the next move."
    return system, user


def parse_next_action(result: object, allowed: list[str]) -> NextAction:
    """Validate the planner's choice. Anything outside the list becomes a question
    to the user rather than an invented action."""
    permitted = set(allowed) & ACTION_KEYS
    if not isinstance(result, dict):
        return _ask("I could not work out a next move from the current state. What should happen next?")
    key = str(result.get("action_key") or "")
    if key not in permitted:
        logger.warning(f"Planner chose {key!r}, outside the allowed actions; asking the user instead")
        return _ask(f"I considered '{key or 'nothing'}', which is not available here. What would you like to do next?")
    params = result.get("params") if isinstance(result.get("params"), dict) else {}
    question = result.get("decision_question")
    return NextAction(
        action_key=key,
        params=params,
        rationale=str(result.get("rationale") or "").strip(),
        expected_outcome=str(result.get("expected_outcome") or "").strip(),
        needs_user_decision=bool(result.get("needs_user_decision")) or key == "request_user_decision",
        decision_question=str(question).strip() if question else None,
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
    return parse_next_action(result, allowed)


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
    "what is asked. Standard library, numpy, scipy, sympy and matplotlib are "
    "available; nothing else, and no network access. Print every result the "
    "reader needs, clearly labelled. Save any plot to /out/<name>.png. Return "
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
