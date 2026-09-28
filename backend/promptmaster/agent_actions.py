"""The fixed set of moves Go mode can make (PM-17, PM-19).

A closed list, deliberately. The planner model chooses among these and cannot
invent a new kind of action; each key maps to exactly one way of being
performed in the client, and to the execution label that performing it can
honestly earn. The frontend mirror is frontend/src/lib/agent/actions.ts;
agent-action-drift.test.ts keeps the two identical.

Sean, Sep 10: "For theorem/physics/research work, that next-best-action loop
might choose among: derive; prove; simplify; test a limiting case; try a
contradiction; run a computation; falsify a hypothesis; compare alternatives;
check literature; update assumptions."
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

Family = Literal["research", "writing", "workflow"]


class AgentAction(BaseModel):
    key: str
    family: Family
    label: str
    #: One line the planner reads to know when this is the right move.
    when: str
    #: Stops a Checkpoint run for the user's approval before it is performed.
    important: bool = False


AGENT_ACTIONS: list[AgentAction] = [
    # --- research: Sean's list, in his order ---------------------------------
    AgentAction(key="derive", family="research", label="Derive",
                when="Work a result out step by step from what is already established."),
    AgentAction(key="prove", family="research", label="Prove",
                when="Turn a claim that is believed into one that is shown."),
    AgentAction(key="simplify", family="research", label="Simplify",
                when="Reduce an expression, model or argument to its essential form."),
    AgentAction(key="limiting_case", family="research", label="Test a limiting case",
                when="Check the result behaves correctly at extremes or known special cases."),
    AgentAction(key="try_contradiction", family="research", label="Try a contradiction",
                when="Assume the opposite and see whether it breaks."),
    AgentAction(key="run_computation", family="research", label="Run a computation",
                when="A number, plot or simulation would settle the question better than argument. "
                     "Params: goal (what to compute), kind ('computation' or 'simulation').",
                important=True),
    AgentAction(key="falsify_hypothesis", family="research", label="Falsify a hypothesis",
                when="State what would prove the current hypothesis wrong, and test it."),
    AgentAction(key="compare_alternatives", family="research", label="Compare alternatives",
                when="Weigh competing explanations or approaches against the evidence."),
    AgentAction(key="check_literature", family="research", label="Check literature",
                when="What is already known or published would change the next step."),
    AgentAction(key="update_assumptions", family="research", label="Update assumptions",
                when="Something found so far means an assumption no longer holds.",
                important=True),
    # --- writing: the stage's own work --------------------------------------
    AgentAction(key="draft_stage", family="writing", label="Draft this stage",
                when="The stage has no draft yet."),
    AgentAction(key="evaluate_stage", family="writing", label="Check this stage",
                when="There is a draft that has not been checked against the objective."),
    AgentAction(key="revise_stage", family="writing", label="Revise this stage",
                when="The draft has specific problems worth fixing. Params: instruction.",
                important=True),
    # B2b: the stage-specific work the buttons do, as moves (Sean, 28 Sep, item 2).
    AgentAction(key="generate_outline", family="writing", label="Generate the outline",
                when="The outline stage has no named sections yet. Produces titles and abstracts "
                     "as a saved outline version for the user to approve or edit."),
    AgentAction(key="draft_sections", family="writing", label="Draft the sections",
                when="Drafting: the approved outline has sections not yet written. Writes every "
                     "unwritten section through the job queue and waits for them.",
                important=True),
    AgentAction(key="revise_sections", family="writing", label="Revise the sections",
                when="Revision or Editing: rewrite the written sections applying this stage's brief "
                     "and the findings accepted before it. The manuscript is saved as a version first.",
                important=True),
    AgentAction(key="apply_findings", family="writing", label="Apply the findings",
                when="The latest check of this draft produced findings that have not been applied. "
                     "Revises the draft against them as a new version.",
                important=True),
    AgentAction(key="triage_findings", family="writing", label="Decide the routine findings",
                when="A review table has undecided minor or moderate findings. Decides each of "
                     "those (accept, defer or reject, with a reason); major ones are left for the user.",
                important=True),
    # --- workflow ---------------------------------------------------------------
    AgentAction(key="advance_stage", family="workflow", label="Move to the next stage",
                when="This stage's work is done and checked.", important=True),
    AgentAction(key="mark_blocked", family="workflow", label="Mark this stage blocked",
                when="A missing tool or missing data stops progress. Params: reason, block_kind."),
    AgentAction(key="request_user_decision", family="workflow", label="Ask the user",
                when="A real choice only the user can make is needed. Set decision_question."),
    AgentAction(key="declare_objective_complete", family="workflow", label="Objective complete",
                when="The objective is met and nothing needs another pass.", important=True),
]

ACTION_KEYS: frozenset[str] = frozenset(a.key for a in AGENT_ACTIONS)
ACTIONS_BY_KEY: dict[str, AgentAction] = {a.key: a for a in AGENT_ACTIONS}

#: Reasoning moves performed by /api/agent/reason. Their honest label is
#: "discussed" — nothing was run.
REASONING_ACTIONS: frozenset[str] = frozenset({
    "derive", "prove", "simplify", "limiting_case", "try_contradiction",
    "falsify_hypothesis", "compare_alternatives", "update_assumptions",
})
