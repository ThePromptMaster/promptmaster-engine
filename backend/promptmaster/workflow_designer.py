"""Design a workflow for work the built-in ones do not fit (3 Oct call).

The client: "is it going to be able to create the stages as it goes, and then
create the workflow within them — kind of designing itself?", and "cards for
different companies". One JSON call proposes the stages; the client turns them
into a template, checks it can be walked (`lib/workflow/validate.ts`), lets the
user edit it, and saves it as the user's own. Nothing here touches a database.

The model chooses only among page kinds that already exist, so a generated
workflow runs through the same four renderers as Book and Research, and no
renderer learns which workflow it is in.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .limits import MAX_INSTRUCTION_CHARS
from .llm_client import OpenRouterClient
from .self_model import PROMPTMASTER_SELF_MODEL

MIN_STAGES = 3
MAX_STAGES = 10

#: Page kinds the model may choose, and what each is for.
KINDS = {
    "write": "a page of prose the user reads and edits (a brief, a draft, a plan, the finished piece)",
    "list": "a short table of items (sources, people, options, requirements)",
    "check": "a table of findings about earlier work, each one accepted or rejected by the user",
}


class DesignedStage(BaseModel):
    label: str = Field(max_length=60)
    short_label: str = Field(max_length=24)
    kind: str
    purpose: str = Field(default="", max_length=2_000)
    #: The stage's working instruction; the user may now edit it before the
    #: workflow is saved (6 Oct, email 11), so it has an instruction's room.
    instruction: str = Field(default="", max_length=MAX_INSTRUCTION_CHARS)
    required: bool = True
    #: The user's sign-off in the first person, or "" for none.
    approval: str = Field(default="", max_length=120)
    #: "routine" when the sign-off certifies what can be checked against the
    #: supplied material (Go may commit it under the project's routine-decision
    #: policy); "decision" when it needs the user's judgment (Sean, 5 Oct).
    approval_kind: str = Field(default="decision", pattern="^(routine|decision)$")
    #: A separate, reserved sign-off for new commitments the stage proposes —
    #: a deadline, a budget, a promise not in the source — or "".
    decision: str = Field(default="", max_length=120)


class DesignedWorkflow(BaseModel):
    name: str = Field(max_length=60)
    description: str = Field(default="", max_length=240)
    deliverable: str = Field(default="piece", max_length=40)
    inquiry: bool = False
    stages: list[DesignedStage] = Field(default_factory=list, max_length=MAX_STAGES)


_SYSTEM = (
    "You design workflows for PromptMaster, a structured system that takes a person "
    "from an objective to finished, evaluated work in stages. A good workflow is the "
    "few stages an expert in this kind of work would actually go through, in order: "
    "each stage produces one thing the next one needs, and nothing is there for "
    "ceremony.\n\n" + PROMPTMASTER_SELF_MODEL
)


def build_workflow_prompt(description: str, objective: str) -> tuple[str, str]:
    kinds = "\n".join(f'- "{k}": {v}' for k, v in KINDS.items())
    user = (
        f"THE KIND OF WORK: {description.strip()}\n"
        f"THE USER'S OBJECTIVE: {objective.strip() or '(not given yet)'}\n\n"
        f"Design {MIN_STAGES} to {MAX_STAGES - 2} stages for this kind of work.\n"
        "The first stage states the objective and what success looks like. The last "
        "stage produces the finished deliverable, ready to use. Put a check stage after "
        "the work it checks, never first. Every stage's kind is one of:\n"
        f"{kinds}\n\n"
        "For each stage write:\n"
        "- label: a plain name (≤40 chars), and short_label (≤20 chars) for the side rail\n"
        "- purpose: one sentence the user reads on arrival — what this stage is for\n"
        "- instruction: what the model must produce on this stage, specifically for this "
        "kind of work, including what a lazy answer would look like so it is avoided\n"
        "- required: false only for a stage an expert would often skip\n"
        "- approval: the user's sign-off in the first person (\"I approve this angle\"), "
        "or \"\" when none is needed\n"
        "- approval_kind: \"routine\" when the sign-off only certifies something that can be "
        "checked against the supplied material — an extraction matches its source, every "
        "requirement is covered, the format is followed; \"decision\" when it needs the "
        "user's preference, judgment or authority — choosing an option, accepting a "
        "recommendation, approving something for use or for execution\n"
        "- decision: when a stage both extracts what the user supplied AND may introduce new "
        "commitments (a deadline, a budget, a promise, a scope change not in the source), keep "
        "those apart — approval is the routine check of the extraction, and decision is the "
        "user's own sign-off on the new commitments, in the first person (\"I accept the new "
        "commitments it proposes\"). Otherwise \"\"\n\n"
        "Set inquiry true only when the work investigates or tests ideas (science, "
        "analysis, a thought experiment) rather than writes something.\n\n"
        "Return JSON only:\n"
        '{"name": "...", "description": "one sentence", "deliverable": "noun for the '
        'finished thing, e.g. article", "inquiry": false, "stages": [{"label": "...", '
        '"short_label": "...", "kind": "write|list|check", "purpose": "...", '
        '"instruction": "...", "required": true, "approval": "", "approval_kind": "decision", '
        '"decision": ""}]}'
    )
    return _SYSTEM, user


def _clip(value: object, n: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:n]


def parse_workflow(result: object) -> DesignedWorkflow:
    """Keep what is usable; refuse what cannot become a workflow."""
    if not isinstance(result, dict):
        raise ValueError("The design came back in a form that could not be read.")
    stages: list[DesignedStage] = []
    for raw in result.get("stages") or []:
        if not isinstance(raw, dict):
            continue
        label = _clip(raw.get("label"), 60)
        kind = str(raw.get("kind") or "").strip().lower()
        if not label or kind not in KINDS:
            continue
        stages.append(
            DesignedStage(
                label=label,
                short_label=_clip(raw.get("short_label"), 24) or label[:24],
                kind=kind,
                purpose=_clip(raw.get("purpose"), 240),
                instruction=_clip(raw.get("instruction"), 1_200) or f"Produce the {label.lower()}.",
                required=raw.get("required") is not False,
                approval=_clip(raw.get("approval"), 120),
                # Anything unclear is the user's: only an explicit "routine" is delegable.
                approval_kind="routine" if str(raw.get("approval_kind") or "").strip().lower() == "routine" else "decision",
                decision=_clip(raw.get("decision"), 120),
            )
        )
    stages = stages[:MAX_STAGES]
    # The ends are fixed: a check stage cannot open or close the work.
    while stages and stages[0].kind == "check":
        stages.pop(0)
    while stages and stages[-1].kind == "check":
        stages.pop()
    if len(stages) < MIN_STAGES:
        raise ValueError("The design had too few usable stages. Try describing the work in more detail.")
    stages[0].required = True
    stages[-1].required = True
    return DesignedWorkflow(
        name=_clip(result.get("name"), 60) or "Custom workflow",
        description=_clip(result.get("description"), 240),
        deliverable=_clip(result.get("deliverable"), 40) or "piece",
        inquiry=bool(result.get("inquiry")),
        stages=stages,
    )


async def design_workflow(
    client: OpenRouterClient, model: str | None, description: str, objective: str
) -> DesignedWorkflow:
    system, user = build_workflow_prompt(description, objective)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0.4, max_tokens=3_000, model=model)
    return parse_workflow(result)
