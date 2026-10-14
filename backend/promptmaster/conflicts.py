"""Conflict detection for a typed instruction (PM-24).

Sean, Sep 10: "Conflict detection still matters: current instruction vs
project objective; current instruction vs prior decision; one instruction vs
another; user should be asked which should control when there is a real
conflict."

This is the model half. The deterministic half — opposite directions on the
closed vocabulary of combine.ts ("shorter" vs "longer") — runs in the browser
first and costs nothing (lib/workflow/conflicts.ts). What a keyword list cannot
see is meaning: "add a section on sexual selection" does not share a word with
a constraint of "under 300 words", and it is still a conflict. One cheap JSON
call looks for those, against the three things Sean named and nothing else.

The bar is set high on purpose. A user who is asked "which should control?"
about a refinement that contradicts nothing learns to click through the
question, and then misses the real one.
"""

from __future__ import annotations

import re

from typing import Literal

from pydantic import BaseModel, Field

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import PMInput

ConflictKind = Literal["objective", "constraint", "decision", "fact", "instruction"]


class ConflictSource(BaseModel):
    id: str
    text: str = Field(max_length=2_000)


class ConflictStage(BaseModel):
    """The stage the instruction is for: its name and what it produces."""
    label: str = Field(default="", max_length=200)
    instruction: str = Field(default="", max_length=2_000)


class Conflict(BaseModel):
    kind: ConflictKind
    #: The id of the decision, fact or instruction it conflicts with; "" for the objective or constraints.
    with_id: str = ""
    with_text: str
    explanation: str
    #: 14 Oct (Sean, LANTERN): the buttons repeated raw instruction text with
    #: nested quotes. Each side of the choice is named in a few plain words, and
    #: what keeping the record means is said once.
    keep_label: str = ""
    override_label: str = ""
    #: What PromptMaster will do if the record is kept, in one sentence.
    resolution: str = ""
    #: The record says who must approve a change, and the instruction would
    #: treat a change nobody approved as approved.
    protects_approval: bool = False


_CONFLICT_INSTRUCTION = (
    "CONFLICT CHECK MODE. The user is about to give an instruction. Decide whether "
    "following it would CONTRADICT any of: the project objective, the project "
    "constraints, a decision the user already made, or another pending "
    "instruction — all listed below.\n\n"
    "Only a REAL conflict counts: following the new instruction would mean "
    "violating or undoing the other thing, so the user must choose which one "
    "controls. A refinement, an addition that fits, a change of wording, or "
    "something merely different is NOT a conflict. When in doubt, it is not a "
    "conflict. Most instructions have none; an empty list is the usual answer.\n\n"
    # 14 Oct (Sean, LANTERN): "as of November 10" in the constraints flagged
    # the November 12 update; Omar's quoted request was weighed as if it could
    # change the approved date; the same update was asked about twice.
    "NOT CONFLICTS: an \"as of\" or reporting date describes the report, not a limit on later "
    "evidence — newer information the user supplies updates it, unless the user asked for a frozen "
    "historical report. Recording a request someone made (\"Omar requests January 15\") is new "
    "evidence, not a decision: it conflicts with nothing, so long as it is recorded as a request. "
    "An instruction that repeats or carries out an earlier decision or applied instruction does not "
    "conflict with it. A later value for a fact the user gives in the instruction updates the fact.\n"
    # 14 Oct, production pass: "The workshop now starts at 10:00 a.m. instead
    # of 9:00 a.m." was asked about twice — against the objective's 9:00, with
    # "Keep the objective" recommended, and against the noon end time that a
    # later start necessarily moves.
    "A value the user changes in their own words (\"the workshop now starts at 10:00 instead of 9:00\", "
    "\"the budget is now $60,000\") is their later word: it is not a conflict with the objective, the "
    "constraints or a fact that state the old value, and neither is anything that follows from it (a "
    "later start moves the end time). Only a recorded approval rule can make such a change a "
    "conflict — and a change someone else is reported to want is a request, not the user's decision.\n\n"
    "APPROVAL RULES come first. Where the objective, the context, a decision or an accepted fact says "
    "who must approve a change (\"only Elena can approve a date change\"), and following the "
    "instruction would treat a change that person has not approved as approved — writing the "
    "unapproved value as the approved one, or removing the record of the request — that is the "
    "conflict to report, with kind \"fact\" (citing the fact's id) or \"decision\" or \"constraint\", "
    "and \"protects_approval\": true. Report it once, not once per place it is written.\n\n"
    "For each real conflict: quote what it conflicts with; say in one plain sentence how the two "
    "pull against each other, naming the people and values (\"Elena hasn't approved moving the date "
    "to January 15.\"); say in one sentence what keeping the record would mean (\"I'll keep December "
    "18 as the approved target and record Omar's request as unapproved.\"); and name the two choices "
    "in at most six plain words each, with no quotation marks and no quoted instruction text "
    "(\"Keep December 18 approved\", \"Treat January 15 as approved\").\n\n"
    "Return JSON only:\n"
    '{"conflicts": [{"kind": "objective|constraint|decision|fact|instruction", '
    '"with_id": "the id shown, or empty for the objective/constraints", '
    '"with_text": "what it conflicts with", "explanation": "one sentence", '
    '"resolution": "one sentence", "keep_label": "at most six words", '
    '"override_label": "at most six words", "protects_approval": true|false}]}'
)


# A stage's own work is not a conflict with constraints written for the whole
# deliverable. Told only "analyse the 200-customer CSV", the check stopped Go
# from tidying a Literature stage's map of sources, as "a different deliverable
# from analysing the CSV" (production Research pass, 3 Oct). The stage's
# instruction outranks the constraints (precedence.py); the check now knows it.
_STAGE_RULE = (
    "THE STAGE THIS INSTRUCTION IS FOR is given below with what it produces. The "
    "objective and constraints describe the finished deliverable as a whole; an "
    "instruction that serves this stage's own work, as the stage describes it, does "
    "not conflict with them because this stage's product differs from the final one. "
    "For any objective or constraint conflict you still list, add "
    '"within_stage_work": true if following the instruction only produces what THIS '
    "STAGE says it produces (its form, columns or scope), false otherwise."
)


def build_conflict_prompt(
    inputs: PMInput, instruction: str, decisions: list[ConflictSource], others: list[ConflictSource],
    stage: ConflictStage | None = None,
) -> tuple[str, str]:
    system = _shared_system(inputs, [], _CONFLICT_INSTRUCTION)
    listed = lambda items: "\n".join(f"- [{i.id}] {i.text}" for i in items) or "(none)"  # noqa: E731
    user = "\n".join([
        f"OBJECTIVE: {inputs.objective or '(none)'}",
        f"CONSTRAINTS: {inputs.constraints or '(none)'}",
        "",
        "DECISIONS THE USER ALREADY MADE:",
        listed(decisions),
        # 8 Oct (production, TaskBoard): the user answered Go's "which date and
        # price?" and the answer was recorded as an accepted fact; the check,
        # shown no facts, said "no such decision exists" and asked again.
        *(
            [
                "ACCEPTED PROJECT FACTS (each is a decision the user made or accepted; an "
                "instruction that applies one of them carries out the user's decision and does "
                "not conflict with an objective that asked for that decision to be made first):",
                *[f"- [{fid}] {' '.join(f.statement.split())}" for fid, f in fact_sources(inputs)],
            ]
            if inputs.facts else []
        ),
        "",
        "OTHER PENDING INSTRUCTIONS:",
        listed(others),
        "",
        *(
            ["", f"THE STAGE THIS INSTRUCTION IS FOR: {stage.label}"
             + (f" — it produces: {stage.instruction.strip()}" if stage.instruction.strip() else ""),
             _STAGE_RULE, ""]
            if stage is not None and stage.label.strip() else []
        ),
        "--- THE NEW INSTRUCTION ---",
        instruction.strip(),
        "--- END ---",
        "",
        "List only real conflicts.",
    ])
    return system, user


def fact_sources(inputs: PMInput) -> list[tuple[str, object]]:
    """The accepted facts with the ids a conflict cites them by: F1, F2, …"""
    return [(f"F{i + 1}", f) for i, f in enumerate(f for f in (inputs.facts or []) if f.statement.strip())]


#: A label is a few plain words: no quotation marks, no quoted instruction.
_LABEL_MAX_WORDS = 8


def _label(raw: object) -> str:
    text = " ".join(str(raw or "").split()).strip(" .")
    if not text or any(q in text for q in "\"“”«»") or len(text.split()) > _LABEL_MAX_WORDS:
        return ""
    return text[:80]


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _from_user(with_text: str, user_text: str) -> bool:
    """Whether a quoted objective or constraint is the user's own words.

    Sean's physics review (6 Oct) showed "an internal instruction conflict
    about JSON versus a Markdown derivation": the check had quoted the
    system's own format scaffolding as a constraint. Only text the user wrote
    can be in conflict with them; most of the quote's words must be there.
    """
    quote = [w for w in _words(with_text) if len(w) > 2]
    if not quote:
        return False
    have = set(_words(user_text))
    return sum(w in have for w in quote) / len(quote) >= 0.8


def parse_conflicts(
    raw: object, decisions: list[ConflictSource], others: list[ConflictSource], stage_given: bool = False,
    user_text: str | None = None, facts: list[ConflictSource] | None = None,
) -> list[Conflict]:
    """Keep only well-formed conflicts that point at something that was actually listed.

    `stage_given`: the check was told which stage the instruction is for.
    Then an objective or constraint conflict the check itself marks
    `within_stage_work` — the instruction only asks for what the stage says it
    produces — is dropped here, in code. The stage outranks both
    (precedence.py), and the prompt's stage rule alone let one through (Sean,
    2 Oct screenshot: Book's research notes as the claim/source/confidence
    table the stage asks for, called "a different deliverable from writing
    the book"). A revision that really pulls against the objective is still
    asked about.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("conflicts"), list):
        return []
    known = {s.id: s.text for s in [*decisions, *others]}
    known_facts = {s.id: s.text for s in (facts or [])}
    out: list[Conflict] = []
    for item in raw["conflicts"][:5]:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        explanation = str(item.get("explanation") or "").strip()
        if kind not in ("objective", "constraint", "decision", "fact", "instruction") or not explanation:
            continue
        if stage_given and kind in ("objective", "constraint") and item.get("within_stage_work") is True:
            continue
        with_id = str(item.get("with_id") or "")
        if kind == "fact":
            # A fact that was never listed is invented.
            if with_id not in known_facts:
                continue
            with_text = known_facts[with_id]
        elif kind in ("decision", "instruction"):
            # A conflict with something that was never listed is invented.
            if with_id not in known:
                continue
            with_text = known[with_id]
        else:
            with_id = ""
            with_text = str(item.get("with_text") or "").strip()
            if not with_text:
                continue
            if user_text is not None and not _from_user(with_text, user_text):
                continue
        out.append(Conflict(
            kind=kind, with_id=with_id, with_text=with_text[:2_000], explanation=explanation[:500],
            keep_label=_label(item.get("keep_label")), override_label=_label(item.get("override_label")),
            resolution=" ".join(str(item.get("resolution") or "").split())[:300],
            protects_approval=item.get("protects_approval") is True,
        ))
    # The approval the record protects is the question; it is asked first.
    return sorted(out, key=lambda c: not c.protects_approval)


async def find_conflicts(
    client: OpenRouterClient, model: str | None, inputs: PMInput, instruction: str,
    decisions: list[ConflictSource], others: list[ConflictSource], stage: ConflictStage | None = None,
) -> list[Conflict]:
    system, user = build_conflict_prompt(inputs, instruction, decisions, others, stage)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0.0, max_tokens=700, model=model)
    user_text = " ".join([inputs.objective, inputs.constraints, inputs.output_format, inputs.audience])
    facts = [ConflictSource(id=fid, text=" ".join(f.statement.split())[:2_000]) for fid, f in fact_sources(inputs)]
    return parse_conflicts(
        raw, decisions, others, stage_given=stage is not None and bool(stage.label.strip()), user_text=user_text, facts=facts,
    )
