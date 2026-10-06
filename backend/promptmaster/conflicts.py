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

from typing import Literal

from pydantic import BaseModel, Field

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import PMInput

ConflictKind = Literal["objective", "constraint", "decision", "instruction"]


class ConflictSource(BaseModel):
    id: str
    text: str = Field(max_length=2_000)


class ConflictStage(BaseModel):
    """The stage the instruction is for: its name and what it produces."""
    label: str = Field(default="", max_length=200)
    instruction: str = Field(default="", max_length=2_000)


class Conflict(BaseModel):
    kind: ConflictKind
    #: The id of the decision or instruction it conflicts with; "" for the objective or constraints.
    with_id: str = ""
    with_text: str
    explanation: str


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
    "For each real conflict, quote what it conflicts with and say in one plain "
    "sentence how the two pull against each other.\n\n"
    "Return JSON only:\n"
    '{"conflicts": [{"kind": "objective|constraint|decision|instruction", '
    '"with_id": "the id shown, or empty for the objective/constraints", '
    '"with_text": "what it conflicts with", "explanation": "one sentence"}]}'
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


def parse_conflicts(
    raw: object, decisions: list[ConflictSource], others: list[ConflictSource], stage_given: bool = False
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
    out: list[Conflict] = []
    for item in raw["conflicts"][:5]:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        explanation = str(item.get("explanation") or "").strip()
        if kind not in ("objective", "constraint", "decision", "instruction") or not explanation:
            continue
        if stage_given and kind in ("objective", "constraint") and item.get("within_stage_work") is True:
            continue
        with_id = str(item.get("with_id") or "")
        if kind in ("decision", "instruction"):
            # A conflict with something that was never listed is invented.
            if with_id not in known:
                continue
            with_text = known[with_id]
        else:
            with_id = ""
            with_text = str(item.get("with_text") or "").strip()
            if not with_text:
                continue
        out.append(Conflict(kind=kind, with_id=with_id, with_text=with_text[:2_000], explanation=explanation[:500]))
    return out


async def find_conflicts(
    client: OpenRouterClient, model: str | None, inputs: PMInput, instruction: str,
    decisions: list[ConflictSource], others: list[ConflictSource], stage: ConflictStage | None = None,
) -> list[Conflict]:
    system, user = build_conflict_prompt(inputs, instruction, decisions, others, stage)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0.0, max_tokens=700, model=model)
    return parse_conflicts(raw, decisions, others, stage_given=stage is not None and bool(stage.label.strip()))
