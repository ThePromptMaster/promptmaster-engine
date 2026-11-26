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

from pydantic import BaseModel, Field, field_validator

from .limits import MAX_INSTRUCTION_CHARS
from .llm_client import OpenRouterClient
from .modes import MODES
from .self_model import PROMPTMASTER_SELF_MODEL

MIN_STAGES = 3
MAX_STAGES = 10

#: Page kinds the model may choose, and what each is for.
KINDS = {
    "write": "a page of prose the user reads and edits (a brief, a draft, a plan, the finished piece)",
    # 15 Nov (Sean, inventory audit): "a short table of each error and its
    # correction" was planned as a list page, which shows cards and exports a
    # numbered list; the deliverable never had a table.
    "list": (
        "a short list of items each with the same few fields (sources, people, options, requirements); "
        "shown as cards, not as a table. A table the user asks for in the finished work is written as a "
        "Markdown table on the \"write\" page that holds the finished work"
    ),
    "check": "a table of findings about earlier work, each one accepted or rejected by the user",
    # 25 Oct (client: screening pasted LinkedIn profiles in batches, colour-coded).
    "assess": (
        "a table the user fills by pasting many similar items a batch at a time (profiles, "
        "applications, proposals, suppliers); each is judged against criteria an earlier stage "
        "set, with a verdict on a scale"
    ),
    # 31 Oct (Sean): a designed book held its whole manuscript in one "write"
    # page, which no single model call can rewrite; a repair was cut off twice
    # and Go stopped. A chapters stage is planned, written and revised a
    # chapter at a time, as Book is.
    "chapters": (
        "book-length work written and revised chapter by chapter — a manuscript, a long report, "
        "a thesis: PromptMaster first asks for a plan of the chapters, then writes each one on its own"
    ),
}

#: The scales an assess stage may name (`lib/workflow/assess.ts` SCALE_PRESETS).
SCALES = ("traffic", "score5", "pass_fail", "grade", "fit")
MAX_SCALE_LEVELS = 7


#: The modes a design may give a stage: every mode but the user's own persona.
THINKING_MODES = tuple(k for k in MODES if k != "custom")
#: `validate.ts` refuses a longer reason, and a refused design is dropped whole.
MODE_REASON_MAX = 80


def thinking_mode(value: object) -> str:
    said = re.sub(r"[\s-]+", "_", str(value or "").strip().lower())
    return said if said in THINKING_MODES else ""


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
    #: Ongoing work (7 Oct): this stage closes a round and the next round
    #: starts again from the stage with this label (an earlier one), or "".
    loop_back_to: str = Field(default="", max_length=60)
    #: Assess stages: a preset scale, or the user's own levels best first.
    scale: str = Field(default="", max_length=20)
    scale_levels: list[str] = Field(default_factory=list, max_length=MAX_SCALE_LEVELS)
    #: Assess stages: what is pasted, plural ("profiles").
    item_noun: str = Field(default="", max_length=40)
    #: How PromptMaster thinks on this stage (26 Nov, Sean: "an option to choose
    #: what way to think or have PromptMaster whatever it thinks best"): one of
    #: the modes, or "" when the design gave none. Anything else is blanked, not
    #: refused, so one stage cannot spoil a revision (`thinking_mode`).
    mode: str = Field(default="", max_length=20)
    #: Why that mode, in a few words, shown beside it.
    mode_reason: str = Field(default="", max_length=MODE_REASON_MAX)

    @field_validator("mode", mode="before")
    @classmethod
    def _known_mode(cls, value: object) -> str:
        return thinking_mode(value)

    @field_validator("mode_reason", mode="before")
    @classmethod
    def _short_reason(cls, value: object) -> str:
        return _clip(value, MODE_REASON_MAX)


class Execution(BaseModel):
    """Whether the work ends or goes on, and when it is done (Sean, 6 Oct,
    emails 10-11: "preserve the execution objective when generating the
    workflow … Reaching the final stage should not by itself mean the original
    objective is satisfied")."""
    kind: str = Field(default="finite", pattern="^(finite|ongoing)$")
    #: What counts as the objective met, in the user's words where they gave it.
    success_criterion: str = Field(default="", max_length=2_000)
    #: When to stop short of it: a blocker, exhausted branches, a decision.
    stop_conditions: list[str] = Field(default_factory=list, max_length=8)


class DesignedWorkflow(BaseModel):
    name: str = Field(max_length=60)
    description: str = Field(default="", max_length=240)
    deliverable: str = Field(default="piece", max_length=40)
    inquiry: bool = False
    execution: Execution = Field(default_factory=Execution)
    stages: list[DesignedStage] = Field(default_factory=list, max_length=MAX_STAGES)


_SYSTEM = (
    "You design workflows for PromptMaster, a structured system that takes a person "
    "from an objective to finished, evaluated work in stages. A good workflow is the "
    "few stages an expert in this kind of work would actually go through, in order: "
    "each stage produces one thing the next one needs, and nothing is there for "
    "ceremony.\n\n" + PROMPTMASTER_SELF_MODEL
)


#: What the stages may rely on for outside facts (24 Oct, prod pass: with
#: Web access on, a designed stage said "Do not state prices as current fact:
#: mark each as 'to verify on vendor site'", and its draft searched nothing).
WEB_ON_RULE = (
    "WEB ACCESS: on. PromptMaster searches the public web while a stage is written and cites "
    "what it finds. Where a stage needs current outside facts — prices, plans, terms, figures, "
    "published rules — its instruction says to take them from the web sources found, cite each "
    "one and give the date checked. Never tell a stage to leave such facts unverified, to mark "
    "them for the user to look up, or to rely only on what the user pastes."
)
WEB_OFF_RULE = (
    "WEB ACCESS: off. PromptMaster cannot search the web for this work. Where a stage needs "
    "current outside facts, its instruction says to use what the user supplied and to mark "
    "anything else as unverified, with what is left to check."
)


#: Stages asked for at each depth (11 Nov): the request, not the way in, decides how
#: many. A concise request is not designed at all: it is the one-stage workflow.
STAGE_RANGE = {"standard": (MIN_STAGES, 5), "full": (5, MAX_STAGES - 2)}


def build_workflow_prompt(description: str, objective: str, web_access: str | None = None, depth: str | None = None) -> tuple[str, str]:
    low, high = STAGE_RANGE.get(depth or "", (MIN_STAGES, MAX_STAGES - 2))
    sized = {
        "standard": " This is one deliverable of ordinary size: keep to the fewest stages that do the work, and mark "
        "\"required\": false on any stage it could be finished without.",
        "full": " This is long or many-part work: give it the stages an expert would really go through.",
    }.get(depth or "", "")
    kinds = "\n".join(f'- "{k}": {v}' for k, v in KINDS.items())
    web = {"on": WEB_ON_RULE, "off": WEB_OFF_RULE}.get(web_access or "", "")
    user = (
        f"THE KIND OF WORK: {description.strip()}\n"
        f"THE USER'S OBJECTIVE: {objective.strip() or '(not given yet)'}\n\n"
        + (f"{web}\n\n" if web else "")
        + f"Design {low} to {high} stages for this kind of work.{sized}\n"
        "The first stage states the objective and what success looks like. The last "
        "stage produces the finished deliverable, ready to use. Put a check stage after "
        "the work it checks, never first — after EVERY stage whose output it checks: a final "
        "verification of several deliverables comes after the last of them, never between "
        "them (Sean, 7 Oct: verification was placed before the invitation it had to verify). "
        "Every stage's kind is one of:\n"
        f"{kinds}\n\n"
        "Use \"assess\" only when the user will judge many similar items against fixed criteria, "
        "again and again — screening, triage, grading, shortlisting — not for checking the work "
        "itself. Then a write stage before it sets the criteria (must-haves, positives, "
        "deal-breakers) with the user's approval, the assess stage judges the pasted items, and a "
        "last write stage summarises the results to share; nothing drafts or reviews a deliverable "
        "in between. On an assess stage also give: scale, one of "
        + ", ".join(f'\"{x}\"' for x in SCALES)
        + " (traffic light, 1 to 5, pass/fail, A to F, strong/possible/not a fit), or "
        "scale_levels: the user's own levels best first when they named them (\"strong yes, "
        "yes, no\"), else []; and item_noun: what the user pastes, plural (\"profiles\"). Never "
        "a criterion about a protected characteristic (age, gender, ethnicity, religion, "
        "disability, family status).\n\n"
        "Use \"chapters\" when the deliverable is book-length or runs to many chapters or long "
        "sections (a book, a manuscript, a thesis, a long report) — never one \"write\" stage for the "
        "whole of such a work, which is too long to write or revise in one pass. At most one chapters "
        "stage, never first; stages before it set what the chapters need (scope, audience, evidence); "
        "a stage after it may check or finish the whole. Its instruction says how each chapter is "
        "written.\n\n"
        "For each stage write:\n"
        "- label: a plain name (≤40 chars), and short_label (≤20 chars) for the side rail\n"
        "- purpose: one sentence the user reads on arrival — what this stage is for\n"
        "- instruction: what the model must produce on this stage, specifically for this "
        "kind of work, including what a lazy answer would look like so it is avoided. Name "
        "sections, headings or their order only when the user gave them, in the user's words; "
        "otherwise say what the work must contain and leave its structure to the writer — a "
        "check enforces what an instruction names\n"
        "- required: false only for a stage an expert would often skip\n"
        # 26 Nov (Sean): "have PromptMaster whatever it thinks best". The stage is worked in
        # this mode unless the user picks one way of thinking for every step.
        "- mode: how PromptMaster should think on this stage, one of "
        + ", ".join(f'"{k}" ({MODES[k]["tagline"].lower()})' for k in THINKING_MODES)
        + ". A stage that checks or challenges work is \"critic\" (\"cold_critic\" when the user wants it "
        "blunt); one that weighs evidence, figures or options is \"analyst\"; one that plans or structures "
        "is \"architect\"; one that writes the finished work for its reader is \"clarity\". Use \"coach\" or "
        "\"therapist\" only when the work itself is personal. And mode_reason: why, in under ten words "
        "(\"It checks the draft against the brief\")\n"
        "- approval: the user's sign-off in the first person (\"I approve this angle\"), "
        "or \"\" when none is needed. On a check stage it is about what the check concludes, "
        "never \"I have accepted or rejected each finding\" — every finding having a decision "
        "is already checked automatically\n"
        # 8 Nov (a client): "Autonomous with 'Handle them for me' is pausing for routine approvals".
        # On his book five of six sign-offs came back "decision", among them "I approve this
        # chapter architecture": each stopped a delegated run for a tick.
        "- approval_kind: \"decision\" ONLY for a sign-off that is the user's to give whatever the "
        "checks say: one the user asked to give (\"Approvals wanted: …\"), a choice between options, "
        "accepting a recommendation, approving something to be sent, spent, used with other people "
        "or carried out, and the sign-off on the last stage. "
        # 19 Nov (a client): "Keep warranty verification and actual purchase authorization
        # pending" was the whole of what his brief kept back, yet "I choose the vendor to
        # recommend" became his to give, and the run stopped for it.
        "But a choice or recommendation the user's words hand over (\"make the recommendation "
        "yourself\", \"you choose\", \"handle routine decisions\") is \"routine\", and so is one the brief "
        "does not keep back when it says what it keeps (\"keep X and Y pending\", \"I will authorise Z\"): "
        "the document makes the choice and states the deciding factor. Only what the brief keeps back "
        "and the last stage's sign-off stay \"decision\". "
        "Every other sign-off is \"routine\": it "
        "certifies that the stage's work is sound, complete, consistent or follows what the user "
        "supplied (an extraction matches its source, every requirement is covered, a structure or a "
        "plan fits the brief, the format is followed), which can be checked against the material. "
        "Most sign-offs before the last stage are routine\n"
        # 12 Nov, production: "I choose Option A or Option B (stating which one)." was a tick box,
        # with nowhere to state anything. The page now offers the options the stage sets out.
        "When a sign-off is a choice between options, word it as the decision itself (\"I decide whether "
        "the cap is raised\", \"I choose the recovery option\") and have the stage's instruction set the "
        "options out side by side for the user: the page reads them from the stage and offers each as a "
        "button. Never add an instruction to the user inside an approval (\"stating which one\", "
        "\"state which\")\n"
        "- decision: when a stage both extracts what the user supplied AND may introduce new "
        "commitments (a deadline, a budget, a promise, a scope change not in the source), keep "
        "those apart — approval is the routine check of the extraction, and decision is the "
        "user's own sign-off on the new commitments, in the first person (\"I accept the new "
        "commitments it proposes\"). Otherwise \"\". Never give a decision to a stage whose own instruction "
        "says to add nothing beyond what the user supplied, and never to a stage of a reusable template "
        "whose material the user has not supplied yet: there is nothing new for the user to accept\n"
        # 8 Nov, production: a brief saying "recommend how to resolve any gaps" and "document
        # preparation only" got a stage whose approval was "I choose how the gap will be resolved".
        "When the work is a document, never make an approval or a stop condition out of something the "
        "document is only asked to propose, or something that has to happen outside it (covering a shift, "
        "booking, confirming). The document proposes it and says what is still to do. "
        # 20 Nov, an inventory-selection pass: "I give Finance review sign-off and authorize the
        # purchase of the recommended system." was the last sign-off, and the package it signed
        # recommended no system.
        "Authorising a purchase, a spend or a payment, and a sign-off another team gives (Finance "
        "review, Legal), happen outside the work too, even when the brief keeps them for the user: "
        "never make one an approval or fold it into one, the last stage's included. The deliverable "
        "leaves it pending as the user's next step. The last stage's sign-off approves the finished "
        "deliverable as it stands, and never presumes an outcome the work may not reach (\"the "
        "recommended system\", when none may qualify).\n\n"
        "Set inquiry true only when the work investigates or tests ideas (science, "
        "analysis, a thought experiment) rather than writes something.\n\n"
        "EXECUTION — whether the work ends, and when it is done:\n"
        "- kind \"finite\" when one pass produces the deliverable; \"ongoing\" when the "
        "objective asks to keep going until something is reached (\"continue until a "
        "supported result\", \"keep investigating\"), so a pass may end without it.\n"
        "- success_criterion: what counts as the objective met. Where the objective states "
        "one, copy it in the user's own words; never weaken or paraphrase it into a "
        "finite task. Reaching the last stage is NOT the criterion.\n"
        "- stop_conditions: when to stop short of it (a concrete blocker, exhausted "
        "branches, missing information or capability, a decision only the user can make). "
        # 19 Nov (a client): "only external confirmation could settle it" became a question
        # asking him whether to relax his own eight-week deadline.
        "Never a choice the brief hands over, and for document work never \"the facts are "
        "insufficient\" or \"only external confirmation could settle it\": the document states what is "
        "unconfirmed and what must be confirmed, and is finished. "
        # 20 Nov (Sean, warehouse rerun): "accept a plan with no margin" was put to
        # him as a decision; it was a risk to explain.
        "A risk the work should explain (no margin, no spare capacity, one point of failure) is never "
        "an approval, a decision or a stop condition.\n"
        "- For ongoing work, put a stage just before the last one that closes a round "
        "(e.g. \"Next round\", kind write: what was learned and what to pursue next) and "
        "set its loop_back_to to the label of the earlier stage a new round starts from. "
        "Only that one stage loops; every other stage has loop_back_to \"\".\n\n"
        "Return JSON only:\n"
        '{"name": "...", "description": "one sentence", "deliverable": "noun for the '
        'finished thing, e.g. article", "inquiry": false, "stages": [{"label": "...", '
        '"short_label": "...", "kind": "write|list|check|assess|chapters", "purpose": "...", '
        '"instruction": "...", "required": true, "approval": "", "approval_kind": "decision", '
        '"decision": "", "loop_back_to": "", "scale": "", "scale_levels": [], "item_noun": "", "mode": "", "mode_reason": ""}], '
        '"execution": {"kind": "finite|ongoing", '
        '"success_criterion": "...", "stop_conditions": ["..."]}}'
    )
    return _SYSTEM, user


def _clip(value: object, n: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:n]


#: An act that happens outside the work: authorising, or buying. PromptMaster performs
#: neither, so a sign-off that names one would record it without anything happening.
_OUTSIDE_ACT = re.compile(r"\bauthori[sz](?:e|es|ed|ing|ation)\b|\bpurchas(?:e|es|ed|ing)\b|\bbuy(?:s|ing)?\b", re.I)


def signoff_for_the_work(approval: str, label: str, *, last: bool) -> str:
    """A sign-off that authorises a purchase or a spend becomes the user's approval of the
    stage's own work (20 Nov, an inventory-selection pass: the last stage's "I give Finance
    review sign-off and authorize the purchase of the recommended system." was asked of a
    package that recommended no system). What the brief keeps for the user stays pending
    in the deliverable, as its next step; the prompt says so, and this holds when a design
    does it anyway."""
    if not approval or not _OUTSIDE_ACT.search(approval):
        return approval
    name = label[:1].lower() + label[1:] if label[1:2].islower() else label
    return f"I approve the {name} as final." if last else f"I approve the {name}."


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
                loop_back_to=_clip(raw.get("loop_back_to"), 60),
                mode=raw.get("mode"),
                mode_reason=raw.get("mode_reason"),
                **(_assess_fields(raw) if kind == "assess" else {}),
            )
        )
    stages = stages[:MAX_STAGES]
    # Nor can an assessment: it judges against criteria a stage before it sets.
    while stages and stages[0].kind == "assess":
        stages.pop(0)
    # A check cannot open the work. One that closes it — a final verification
    # — is kept, with a stage after it that produces the finished work (9 Oct:
    # Sean's verification of four deliverables was silently dropped here).
    while stages and stages[0].kind == "check":
        stages.pop(0)
    stages = fix_chapters(with_closing_stage(stages))
    for i, stage in enumerate(stages):
        stage.approval = signoff_for_the_work(stage.approval, stage.label, last=i == len(stages) - 1)
    # The sign-off on the finished work is the user's, whatever the design said (8 Nov):
    # routine sign-offs are the ones before it.
    if stages and stages[-1].approval:
        stages[-1].approval_kind = "decision"
    if len(stages) < MIN_STAGES:
        raise ValueError("The design had too few usable stages. Try describing the work in more detail.")
    stages[0].required = True
    stages[-1].required = True
    execution = parse_execution(result.get("execution"))
    return DesignedWorkflow(
        name=_clip(result.get("name"), 60) or "Custom workflow",
        description=_clip(result.get("description"), 240),
        deliverable=_clip(result.get("deliverable"), 40) or "piece",
        inquiry=bool(result.get("inquiry")),
        execution=execution,
        stages=fix_loops(stages, execution),
    )


def _assess_fields(raw: dict) -> dict:
    """The scale and the noun of an assess stage; a scale nobody can use becomes the traffic light."""
    levels: list[str] = []
    for item in raw.get("scale_levels") or []:
        label = _clip(item, 40)
        if label and label.casefold() not in (x.casefold() for x in levels):
            levels.append(label)
    levels = levels[:MAX_SCALE_LEVELS]
    scale = str(raw.get("scale") or "").strip().lower()
    if len(levels) >= 2:
        scale = ""
    else:
        levels = []
        scale = scale if scale in SCALES else "traffic"
    return {"scale": scale, "scale_levels": levels, "item_noun": _clip(raw.get("item_noun"), 40)}


def parse_execution(raw: object) -> Execution:
    if not isinstance(raw, dict):
        return Execution()
    kind = "ongoing" if str(raw.get("kind") or "").strip().lower() == "ongoing" else "finite"
    stops = [_clip(s, 300) for s in (raw.get("stop_conditions") or []) if _clip(s, 300)][:8]
    return Execution(kind=kind, success_criterion=str(raw.get("success_criterion") or "").strip()[:2_000], stop_conditions=stops)


def fix_chapters(stages: list[DesignedStage]) -> list[DesignedStage]:
    """At most one chapters stage, never the first: the first states the
    objective, and the plan the chapters are written against needs the stages
    before it. Any other becomes a write stage rather than being dropped
    (`validate.ts` checks the same)."""
    seen = False
    out: list[DesignedStage] = []
    for i, s in enumerate(stages):
        if s.kind == "chapters" and (seen or i == 0):
            s = s.model_copy(update={"kind": "write"})
        elif s.kind == "chapters":
            seen = True
        out.append(s)
    return out


def fix_loops(stages: list[DesignedStage], execution: Execution) -> list[DesignedStage]:
    """At most one stage loops, back to an earlier stage, never from the first
    or the last; a finite workflow has none. What the engine cannot walk is
    dropped here rather than saved (`validate.ts` checks the same)."""
    labels = [s.label for s in stages]
    seen = False
    for i, s in enumerate(stages):
        target = s.loop_back_to.strip()
        ok = (
            execution.kind == "ongoing" and not seen and target in labels[:i]
            and 0 < i < len(stages) - 1
        )
        if not ok:
            s.loop_back_to = ""
        else:
            seen = True
    return stages


async def design_workflow(
    client: OpenRouterClient, model: str | None, description: str, objective: str, web_access: str | None = None,
    depth: str | None = None,
) -> DesignedWorkflow:
    system, user = build_workflow_prompt(description, objective, web_access, depth)
    # 3,000 tokens cut a seven-stage design short on 24 Oct; the repair pass
    # rescued it, but a design should not depend on that.
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0.4, max_tokens=6_000, model=model)
    return parse_workflow(result)


FINALISE_LABEL = "Finalise"


def finalise_stage(after: str) -> DesignedStage:
    """The stage that follows a closing check: the finished work, with the
    corrections the check's accepted findings call for."""
    return DesignedStage(
        label=FINALISE_LABEL,
        short_label=FINALISE_LABEL,
        kind="write",
        purpose=f"Produce the finished deliverables, with every correction {after} accepted applied.",
        instruction=(
            f"Assemble the finished deliverables from the earlier stages, applying every finding {after} accepted. "
            "Change nothing else; where a finding was rejected, keep the work as it was."
        ),
        required=True,
        approval="I approve the finished deliverables.",
        approval_kind="decision",
        mode="clarity",
        mode_reason="It writes the finished work for its reader",
    )


def with_closing_stage(stages: list[DesignedStage]) -> list[DesignedStage]:
    """A workflow ends on the finished work. When a check would end it, a
    Finalise stage is added after the check instead of dropping it."""
    if stages and stages[-1].kind == "check":
        if len(stages) >= MAX_STAGES:
            stages = stages[: MAX_STAGES - 1]
        return [*stages, finalise_stage(f"“{stages[-1].label}”")]
    return stages
