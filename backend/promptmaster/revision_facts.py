"""Which accepted facts a revision contradicts in meaning (L-72, 11 Oct).

The facts a revision changes are found in code where the change is a value —
a weekday, a time, a date, an amount, a length limit — and offered for update
with the revision (frontend `lib/workflow/fact-reconcile.ts`). A change of
meaning carries no such value: Sean's onboarding plan moved from an in-office
team to a fully remote one, and a fact saying "the team works in the office"
would stay, outranking the revision in every later prompt.

So one small call reads the revision against the facts the code did not
already match. A fact is reported only when the new text, quoted verbatim,
says something the fact no longer allows, and the user's instruction asked
for that change. Each comes back with the fact rewritten to agree. Nothing is
recorded here; the user ticks or unticks each one with the revision. A failed
check reports nothing, so it never stands between the user and the revision.

12 Oct (Sean, Atlas and Meridian): an instruction can also *add* to the
project's state — "you may now use S1–S7", "Elena approved removing Supplier".
Saved only on the version, it reached no later prompt, so the review held the
revised report to S1–S5 and Go asked to restore the removed rows. The same
call now reports each standing change the instruction states, quoted from the
instruction itself, for the user to record as a fact or requirement.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .fact_filters import RULES, classify, record_kind, records_nothing, the_change
from .llm_client import OpenRouterClient

MAX_FACTS = 60
MAX_CHANGES = 8
MAX_ADDITIONS = 6


class RevisionFact(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    statement: str = Field(min_length=1, max_length=2_000)


class RevisionFactsRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=8_000)
    before: str = Field(default="", max_length=200_000)
    after: str = Field(min_length=1, max_length=200_000)
    facts: list[RevisionFact] = Field(default_factory=list, max_length=MAX_FACTS)
    model: str = ""


class FactMeaningChange(BaseModel):
    fact_id: str
    proposed: str
    quote: str
    why: str = ""


class NewStandingFact(BaseModel):
    statement: str
    kind: str = "fact"  # "fact" | "requirement"
    quote: str
    #: Someone's request, suggestion or proposal: recorded as a fact about it,
    #: shown apart as "Requests noted (not approved)" (17 Oct, Sean, HARBOR).
    request: bool = False
    #: An authority granting something ("The CEO authorizes up to 75 hours"):
    #: shown as an approval, with who granted it (18 Oct, Sean, Ridgeway).
    approval: bool = False
    approved_by: str = ""


class RevisionFactsResponse(BaseModel):
    changes: list[FactMeaningChange] = Field(default_factory=list)
    additions: list[NewStandingFact] = Field(default_factory=list)


_INSTRUCTION = (
    "A user revised a document with an instruction. Some accepted project facts may no longer be true "
    "after the revision. Report ONLY a fact that the user's INSTRUCTION changes and that the REVISED TEXT "
    "now contradicts — for example, the instruction makes the team fully remote and a fact says the team "
    "works in the office. A fact the revision merely leaves out, rewords, or does not touch is not "
    "reported. A fact about something the instruction did not ask to change is not reported. When in "
    "doubt, report nothing.\n"
    "For each fact you report: its id exactly as given; the fact rewritten so it agrees with the revision, "
    "changing as little as possible; a quote copied verbatim from the revised text that shows the change "
    "(one sentence or less); and a few words on what changed.\n"
    "SEPARATELY, report each STANDING change the INSTRUCTION itself states that later work must respect and "
    "that no accepted fact already says: a change to the permitted evidence or sources (\"use S1–S7\"), "
    "an approved removal or addition and who approved it, a new or moved date, a figure, or a rule to "
    "preserve something. Write each as one short self-contained statement, mark it \"requirement\" when it "
    "binds what the work may say or must keep and \"fact\" otherwise, and quote the instruction verbatim "
    "(one sentence or less). A one-off wording or style request is not a standing change. When in doubt, "
    "report nothing. Give each a status: \"approval\" when someone with authority grants or authorizes it "
    "(and name them in \"authority\"), \"request\" when someone only asks for or proposes it, otherwise "
    "\"fact\".\n"
    "Rules for standing changes:\n" + RULES +
    "Return JSON: {\"changes\": [{\"fact_id\": string, \"proposed\": string, \"quote\": string, \"why\": string}], "
    "\"additions\": [{\"statement\": string, \"kind\": \"fact\" | \"requirement\", \"quote\": string, "
    "\"status\": \"fact\" | \"request\" | \"approval\", \"authority\": string}]}"
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>]", "", text.replace("\\", ""))).strip().lower()


def build_prompt(req: RevisionFactsRequest) -> tuple[str, str]:
    facts = "\n".join(f"- [{f.id}] {' '.join(f.statement.split())}" for f in req.facts)
    prompt = (
        f"THE USER'S INSTRUCTION:\n{req.instruction.strip()}\n\n"
        f"THE TEXT BEFORE:\n{req.before.strip() or '(none)'}\n\n"
        f"THE REVISED TEXT:\n{req.after.strip()}\n\n"
        f"ACCEPTED FACTS:\n{facts or '(none)'}"
    )
    return _INSTRUCTION, prompt


def parse(raw: object, req: RevisionFactsRequest) -> RevisionFactsResponse:
    """A change is kept only for a fact that was listed, with a quote verbatim in
    the revised text; an addition only with a quote verbatim in the instruction."""
    if not isinstance(raw, dict):
        return RevisionFactsResponse()
    return RevisionFactsResponse(changes=_changes(raw, req), additions=_additions(raw, req))


def _additions(raw: dict, req: RevisionFactsRequest) -> list[NewStandingFact]:
    items = raw.get("additions")
    if not isinstance(items, list):
        return []
    instruction = _norm(req.instruction)
    known = {_norm(f.statement) for f in req.facts}
    out: list[NewStandingFact] = []
    for item in items[:MAX_ADDITIONS]:
        if not isinstance(item, dict):
            continue
        statement = the_change(" ".join(str(item.get("statement") or "").split())[:2_000])
        quote = " ".join(str(item.get("quote") or "").split()).strip('"“”')[:600]
        if len(statement) < 4 or len(quote) < 4 or _norm(quote) not in instruction:
            continue
        # Filler and how-to-handle-this instructions are never recorded; a
        # request is a fact about the request (the reply-actions path's rules).
        if records_nothing(statement) or records_nothing(the_change(quote)):
            continue
        # The verb decides first (an authority granting it is an approval, a
        # request word a request); the model's status only where the words don't.
        status, by = classify(statement, item.get("status"), item.get("authority"))
        request = status == "request"
        kind = "fact" if request else record_kind(str(item.get("kind") or "").strip().lower(), statement)
        if _norm(statement) in known or any(_norm(a.statement) == _norm(statement) for a in out):
            continue
        out.append(NewStandingFact(statement=statement, kind=kind, quote=quote, request=request, approval=status == "approval", approved_by=by))
    return out


def _changes(raw: dict, req: RevisionFactsRequest) -> list[FactMeaningChange]:
    if not isinstance(raw.get("changes"), list):
        return []
    by_id = {f.id: f for f in req.facts}
    after = _norm(req.after)
    out: list[FactMeaningChange] = []
    for item in raw["changes"][:MAX_CHANGES]:
        if not isinstance(item, dict):
            continue
        fact = by_id.get(str(item.get("fact_id") or ""))
        proposed = " ".join(str(item.get("proposed") or "").split())[:2_000]
        quote = " ".join(str(item.get("quote") or "").split()).strip('"“”')[:600]
        if not fact or not proposed or len(quote) < 8 or _norm(quote) not in after:
            continue
        if _norm(proposed) == _norm(fact.statement) or any(c.fact_id == fact.id for c in out):
            continue
        out.append(FactMeaningChange(fact_id=fact.id, proposed=proposed, quote=quote, why=" ".join(str(item.get("why") or "").split())[:300]))
    return out


async def revision_facts(client: OpenRouterClient, req: RevisionFactsRequest) -> RevisionFactsResponse:
    if not req.after.strip():
        return RevisionFactsResponse()
    system, prompt = build_prompt(req)
    try:
        raw, _usage = await client.generate_json(prompt=prompt, system=system, temperature=0, max_tokens=1_200, model=req.model or None)
    except Exception:  # noqa: BLE001 — a failed check never blocks the revision
        return RevisionFactsResponse()
    return parse(raw, req)
