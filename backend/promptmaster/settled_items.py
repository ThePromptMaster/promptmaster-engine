"""Has the user's own answer settled a finding still counted as open? (12 Nov)

On a training plan the check asked the user to "confirm absences or leave". They
marked the row Deferred and wrote the answer as its reason: "There are no
additional absences to account for". The stage's approval read that note, but
the finish counted every deferred major row as unmet, whatever its note said,
and Go stopped on it; after the note was reworded, it stopped on it again.
Nothing ever read the note, and nothing closed a row once it was deferred.

One small model call reads each open finding beside the user's own words: the
note written on the finding, and the facts and decisions they stated. A finding
is settled only with the words that settle it, copied from that note or
statement and found there in code. Postponing is not answering, and a finding
that says the work itself is wrong is settled by changing the work, never by a
statement. Any failure settles nothing: the finding stays open and is put to
the user, as before. A check, so it never searches the web.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient
from .schemas import PMInput

#: Reading a note against a finding does not need the default model.
SETTLES_MODEL = "anthropic/claude-sonnet-5.5"

MAX_ITEMS = 12
MAX_STATEMENTS = 80

SETTLES_INSTRUCTION = (
    "A review of a project raised findings that are still counted as open work. Since then the project's "
    "user has said things in their own words: a note written on a finding itself, and statements recorded "
    "as facts or decisions. For each OPEN FINDING, say whether the user's own words settle it.\n\n"
    "A finding is SETTLED when the user's words answer what it asks or decide what it leaves open. It asks "
    "the user to confirm something, and they confirm or deny it. It says an assumption is untested, and "
    "they state the assumption is to be taken as given for this work. It asks for a decision, and they "
    "have made it. It asks for a figure or a fact, and they supply it.\n\n"
    "A finding is NOT settled when the user's words only postpone it (\"later\", \"next pass\", \"will "
    "check\", \"not now\", \"carry forward\"), repeat it, acknowledge it without answering, or are about "
    "something else. A finding that says the WORK is wrong, missing or inconsistent (a wrong figure, a "
    "missing section, a contradiction in the text) is not settled by anything said: the work has to "
    "change. If you are unsure, it is not settled.\n\n"
    "For each settled finding give:\n"
    "- id: the finding's id\n"
    "- by: \"note\" when the note on that same finding settles it; otherwise the id of the STATEMENT that does\n"
    "- quote: the user's words that settle it, copied exactly from that note or statement, 8 to 300 characters\n"
    "- why: one short sentence\n\n"
    "Return JSON only: {\"settled\": [{\"id\": \"...\", \"by\": \"...\", \"quote\": \"...\", \"why\": \"...\"}]}. "
    "Leave out every finding that is not settled."
)


class OpenItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    stage: str = Field(default="", max_length=300)
    #: What the finding says, with its suggested change.
    text: str = Field(..., min_length=1, max_length=2_500)
    #: The reason the user wrote with its status; "" when they wrote none.
    note: str = Field(default="", max_length=1_500)


class Statement(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    text: str = Field(..., min_length=1, max_length=2_500)


class SettlesRequest(BaseModel):
    inputs: PMInput
    items: list[OpenItem] = Field(default_factory=list, max_length=MAX_ITEMS)
    #: What the user stated or decided, in their own words: never a draft, never a model's assumption.
    statements: list[Statement] = Field(default_factory=list, max_length=MAX_STATEMENTS)
    model: str = Field(default="", max_length=200)


class Settled(BaseModel):
    id: str
    #: "note", or the id of the statement that settles it.
    by: str
    quote: str
    why: str = ""


class SettlesResponse(BaseModel):
    settled: list[Settled] = Field(default_factory=list)


def build_settles_prompt(req: SettlesRequest) -> tuple[str, str]:
    findings = "\n\n".join(
        f"[{i.id}] {i.stage or 'A stage'}\nFINDING: {' '.join(i.text.split())}\n"
        f"THE USER'S NOTE ON IT: {' '.join(i.note.split()) or '(none)'}"
        for i in req.items
    )
    statements = "\n".join(f"[{s.id}] {' '.join(s.text.split())}" for s in req.statements) or "(none)"
    user = (
        f"OBJECTIVE: {req.inputs.objective}\n\n"
        f"OPEN FINDINGS:\n{findings}\n\n"
        f"STATEMENTS THE USER MADE:\n{statements}"
    )
    return SETTLES_INSTRUCTION, user


def parse_settles(result: object, req: SettlesRequest) -> SettlesResponse:
    """A finding is settled only with words found in the note or statement named."""
    if not isinstance(result, dict):
        return SettlesResponse()
    items = {i.id: i for i in req.items}
    statements = {s.id: s for s in req.statements}
    out: list[Settled] = []
    seen: set[str] = set()
    for raw in result.get("settled") or []:
        if not isinstance(raw, dict):
            continue
        fid = str(raw.get("id") or "").strip().strip("[]")
        by = str(raw.get("by") or "").strip().strip("[]")
        quote = " ".join(str(raw.get("quote") or "").split()).strip('"“”')[:300]
        item = items.get(fid)
        if not item or fid in seen or not quote:
            continue
        if by == "note":
            source = item.note
        elif by in statements:
            source = statements[by].text
        else:
            continue
        if not source.strip() or not _found(quote, source):
            continue
        seen.add(fid)
        out.append(Settled(id=fid, by=by, quote=quote, why=" ".join(str(raw.get("why") or "").split())[:300]))
    return SettlesResponse(settled=out)


async def settled_items(client: OpenRouterClient, req: SettlesRequest) -> SettlesResponse:
    has_words = any(i.note.strip() for i in req.items) or bool(req.statements)
    if not req.items or not has_words:
        return SettlesResponse()
    system, user = build_settles_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=900, model=SETTLES_MODEL)
    return parse_settles(result, req)
