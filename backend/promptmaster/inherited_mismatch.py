"""Does something said lower down disagree with a rule a folder above hands down? (24 Nov)

Sean, 23 Nov ("Inheritance & exceptions"): "say the client folder says the client
handles references, but a consultant adds a note saying [the firm] is handling them
on this search. I'd want PromptMaster to surface both and offer something like
Apply exception to this search ... A newer note or a deeper folder shouldn't
silently win."

The conflict check (`conflicts.py`) treats a value the user changes as their later
word, which is right inside one project and wrong here: a note in a search does
not quietly replace the client's rule. So this is its own small call. It is given
the rules the folders above hand down (I1, I2, …), the new statements made lower
down (A1, …), and rules already set below the new statement's folder (D1, …), and
returns each pair that cannot both hold, with a quote from each side found word
for word in code. Any failure finds nothing: nothing is held, and the user can
still see both statements side by side in the folder. A check, so it never
searches the web.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient

#: Reading two short statements against each other does not need the default model.
MISMATCH_MODEL = "anthropic/claude-sonnet-5.5"

MAX_RULES = 100
MAX_STATEMENTS = 30
MAX_BELOW = 60

MISMATCH_INSTRUCTION = (
    "A firm keeps its work in folders: a workspace, a folder per client, a folder per assignment inside it, "
    "and so on. Each folder holds rules and facts that apply to everything below it. You are given the "
    "RULES FROM ABOVE that a place inherits, and STATEMENTS made in that place or below it. Find each "
    "statement that cannot hold at the same time as one of the rules, for the same work: one says the "
    "client does something and the other says the firm does it; one sets a number, date, format, recipient "
    "or owner and the other sets a different one for the same thing.\n\n"
    "Not a mismatch: a statement that adds detail the rule allows, narrows it without contradicting it, is "
    "about something else, or only restates it. A statement that says it is an exception is still a "
    "mismatch: the user decides whether the exception is approved. If you are unsure, it is not a mismatch.\n\n"
    "For each mismatch give:\n"
    "- rule: the id of the rule (I1, I2, …)\n"
    "- statement: the id of the statement (A1, … or D1, …)\n"
    "- rule_quote: the words of the rule that conflict, copied exactly, 8 to 300 characters\n"
    "- statement_quote: the words of the statement that conflict, copied exactly, 8 to 300 characters\n"
    "- explanation: one short plain sentence naming what the two disagree about\n\n"
    'Return JSON only: {"mismatches": [{"rule": "I1", "statement": "A1", "rule_quote": "...", '
    '"statement_quote": "...", "explanation": "..."}]}. An empty list when nothing conflicts.'
)


class InheritedRule(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    statement: str = Field(..., min_length=1, max_length=2_000)
    #: Where it is set, in words: 'the client folder "Acme"'.
    scope: str = Field(default="", max_length=300)
    required: bool = False


class LowerStatement(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    statement: str = Field(..., min_length=1, max_length=2_000)
    #: Where it was said: 'the search folder "CFO"' or 'the project "CFO review"'.
    place: str = Field(default="", max_length=300)
    #: "new": just added; "below": a rule already set further down.
    kind: Literal["new", "below"] = "new"


class MismatchRequest(BaseModel):
    rules: list[InheritedRule] = Field(default_factory=list, max_length=MAX_RULES)
    statements: list[LowerStatement] = Field(default_factory=list, max_length=MAX_STATEMENTS + MAX_BELOW)
    model: str = Field(default="", max_length=200)


class Mismatch(BaseModel):
    rule_id: str
    statement_id: str
    rule_quote: str
    statement_quote: str
    explanation: str = ""


class MismatchResponse(BaseModel):
    mismatches: list[Mismatch] = Field(default_factory=list)
    #: False when the check did not run (a failure): nothing is recorded as read.
    checked: bool = False


def _labels(req: MismatchRequest) -> tuple[dict[str, InheritedRule], dict[str, LowerStatement]]:
    rules = {f"I{i + 1}": r for i, r in enumerate(req.rules)}
    new = [s for s in req.statements if s.kind == "new"]
    below = [s for s in req.statements if s.kind == "below"]
    statements = {f"A{i + 1}": s for i, s in enumerate(new)} | {f"D{i + 1}": s for i, s in enumerate(below)}
    return rules, statements


def build_mismatch_prompt(req: MismatchRequest) -> tuple[str, str]:
    rules, statements = _labels(req)
    rule_lines = "\n".join(
        f"[{label}] {' '.join(r.statement.split())}"
        + (f" (set in {r.scope})" if r.scope else "")
        + (" (required)" if r.required else "")
        for label, r in rules.items()
    )
    new = "\n".join(
        f"[{label}] {' '.join(s.statement.split())}" + (f" (said in {s.place})" if s.place else "")
        for label, s in statements.items() if label.startswith("A")
    ) or "(none)"
    below = "\n".join(
        f"[{label}] {' '.join(s.statement.split())}" + (f" (set in {s.place})" if s.place else "")
        for label, s in statements.items() if label.startswith("D")
    ) or "(none)"
    user = f"RULES FROM ABOVE:\n{rule_lines}\n\nNEW STATEMENTS:\n{new}\n\nRULES ALREADY SET BELOW:\n{below}"
    return MISMATCH_INSTRUCTION, user


def parse_mismatches(result: object, req: MismatchRequest) -> MismatchResponse:
    """A pair is kept only with a quote from each side found in that side's own words."""
    if not isinstance(result, dict):
        return MismatchResponse()
    rules, statements = _labels(req)
    out: list[Mismatch] = []
    seen: set[tuple[str, str]] = set()
    for raw in result.get("mismatches") or []:
        if not isinstance(raw, dict):
            continue
        rule_label = str(raw.get("rule") or "").strip().strip("[]")
        statement_label = str(raw.get("statement") or "").strip().strip("[]")
        rule = rules.get(rule_label)
        statement = statements.get(statement_label)
        if not rule or not statement:
            continue
        rule_quote = " ".join(str(raw.get("rule_quote") or "").split()).strip('"“”')[:300]
        statement_quote = " ".join(str(raw.get("statement_quote") or "").split()).strip('"“”')[:300]
        if not _found(rule_quote, rule.statement) or not _found(statement_quote, statement.statement):
            continue
        key = (rule.id, statement.id)
        if key in seen:
            continue
        seen.add(key)
        out.append(Mismatch(
            rule_id=rule.id, statement_id=statement.id, rule_quote=rule_quote, statement_quote=statement_quote,
            explanation=" ".join(str(raw.get("explanation") or "").split())[:300],
        ))
    return MismatchResponse(mismatches=out, checked=True)


async def inherited_mismatches(client: OpenRouterClient, req: MismatchRequest) -> MismatchResponse:
    if not req.rules or not req.statements:
        return MismatchResponse(checked=True)
    system, user = build_mismatch_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=900, model=MISMATCH_MODEL)
    return parse_mismatches(result, req)
