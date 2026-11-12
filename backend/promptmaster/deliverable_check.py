"""Whether the finished deliverable carries what was accepted, and holds together.

1 Nov (Sean, two projects). The recruitment plan's final text and the tattoo
memo both passed with accepted corrections only partly made, and with rules
that contradicted the document's own caveats:

- an ad's pause cleared a budget gate, while the restart rule let it run again
  without the reduced limit being verified;
- "campaigns do not stop automatically" beside "an ad set ends when its budget
  is exhausted";
- "adopt expanded hours permanently at $8,000 a month", where $8,000 only
  covers the operating costs and the memo says elsewhere that it does not
  recover the setup;
- "a refundable deposit removes the upfront cash shortfall", when a refundable
  deposit is still paid up front.

"An accepted finding should not be treated as resolved merely because the
decision was recorded", and the final review should check "consistency between
explanations, assumptions and decision rules". This is one call, a check: it
writes nothing and never searches the web (L-100). Every quote it returns is
matched against the text in code; a claim without its passage is dropped, so
the check cannot invent a contradiction it cannot point to.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .limits import clip_by_section
from .llm_client import OpenRouterClient
from .measured import MeasuredLine, measured_block
from .project_context import context_block
from .schemas import PMInput

MAX_FINDINGS = 30
MAX_CONTRADICTIONS = 5
MAX_NOTE_QUOTES = 12
#: The deliverable text the check reads. Longer text is clipped per section and
#: said, not refused: a refusal read as "the check could not run" (5 Nov).
MAX_CHECK_CONTENT = 200_000


class AcceptedFinding(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    stage_label: str = Field(default="", max_length=200)
    finding: str = Field(default="", max_length=1_000)
    suggested_change: str = Field(default="", max_length=1_000)
    #: The length the change asks for, counted in code on the deliverable (12 Nov):
    #: "met: 473 words against about 500". The model judges only the rest of the change.
    length_decided: str = Field(default="", max_length=300)


class RecordedTable(BaseModel):
    """A table the deliverable reports on, as its rows stand (4 Nov, Sean: "In
    Research, the narrative and evidence table disagreed about what had been
    reproduced")."""

    label: str = Field(default="", max_length=200)
    rows: str = Field(default="", max_length=8_000)


MAX_TABLES = 4


class FindingCheck(BaseModel):
    id: str
    #: carried — the deliverable makes the change; not_carried — it still has the
    #: problem or lacks the change; not_applicable — about another document.
    verdict: str
    #: The passage that shows it, verbatim from the deliverable. Empty when none.
    quote: str = ""
    note: str = ""


class Contradiction(BaseModel):
    #: The rule, gate, threshold or recommendation, verbatim from the deliverable.
    rule_quote: str
    #: What it conflicts with: verbatim from the deliverable or an accepted fact.
    conflicts_quote: str
    problem: str
    fix: str = ""


class DeliverableCheck(BaseModel):
    findings: list[FindingCheck] = Field(default_factory=list)
    contradictions: list[Contradiction] = Field(default_factory=list)
    #: How much of the text was shown to the check, in characters.
    read_chars: int = 0
    total_chars: int = 0


_INSTRUCTION = (
    "You check a finished deliverable for five things, and nothing else.\n"
    "1. ACCEPTED FINDINGS. Each was accepted earlier, so the deliverable was meant to make its suggested "
    "change. For each, by its id: \"carried\" when the deliverable now does what the suggested change asks "
    "(quote the passage that shows it); \"not_carried\" when the deliverable still has the problem or lacks "
    "the change (quote the passage that still has it, if there is one, and say in a few words what is "
    "missing); \"not_applicable\" when the finding is about another document and has no bearing on this one. "
    "A finding a later accepted fact or requirement overrides is \"not_applicable\". "
    # 12 Nov (an acquisition memo): a check row had estimated the draft's length by eye and
    # suggested "state the word count, labelled as an estimate". The final memo was shorter and
    # stated none, so this check called the finding not carried three times and Go stopped on it.
    "Length is never yours to judge: where MEASURED IN CODE gives a count, a change that asks for a "
    "length is carried or not by that count alone, and a line marked LENGTH DECIDED IN CODE has "
    "already settled it, so judge only the rest of that change. A change that asks the document to "
    "state, add or estimate its own word count is \"not_applicable\": the count is shown by the page, "
    "not claimed by the text. Never answer \"not_carried\" without saying what the text lacks.\n"
    "2. CONTRADICTIONS. A rule, gate, threshold, condition or recommendation that the deliverable's own "
    "assumptions, caveats, figures or the ACCEPTED PROJECT FACTS AND REQUIREMENTS make wrong or unsafe — for "
    "example: a gate that clears on an action whose restart rule lets the risk return unchecked; a threshold "
    "said to justify a permanent decision when the text says it only covers running costs; a measure said to "
    "solve a cash problem it does not solve; two statements about the same thing that cannot both be true; a "
    "rule applied to a case the text says has different, unknown costs; a statement of what a TABLE ON RECORD "
    "shows that the table's own row contradicts (the text says a result was reproduced, confirmed, completed "
    "or verified; the row says not reproduced, not attempted, deviated or unconfirmed) — quote that row as what "
    "it conflicts with; a term the facts give for only part of "
    "an amount stated of the whole of it (\"$3,380 upfront, nonrefundable\" when only the $2,880 subscription "
    "is said to be nonrefundable and the setup fee's terms are not given). For each: the rule quoted verbatim, "
    "what it conflicts with quoted verbatim (from the deliverable, the brief, or the fact's own words), the problem in one "
    "sentence, and the smallest fix. At most five, most material first. Never report style, tone, length, "
    "missing detail or a point a careful reader would not call contradictory. When in doubt, report nothing.\n"
    # 7 Nov (training event and financial plan tests): "whether operational instructions follow
    # from the financial analysis and its assumptions".
    "3. FOLLOW-THROUGH. What the deliverable tells someone to do, or states as settled, that its own analysis "
    "or what the user supplied (the brief's constraints, the accepted facts, the source material) does not support. "
    "Only these: an instruction to proceed or spend that does not follow from its financial analysis "
    "or ignores an assumption that analysis rests on, such as telling a team to proceed while the same text says "
    "a limit is already breached; a deadline it gives someone that the user did not supply, even one reasoned "
    "from the schedule, unless the text says it is the document's own suggestion; something stated as settled "
    "that what was supplied leaves uncertain, such as money called committed or owed when the record says only "
    "approved, so that an instruction resting on it should be conditional; an earlier suggestion worked out on "
    "numbers that changed after it was made, or treated as on top of a later change or as separate from it, when "
    "nothing supplied says which, even in a list of things not adopted (an old suggestion to add six places, costed "
    "as six on top of a total that has since risen). Something the brief states is supplied: never report it as unsupported. You are "
    "not shown the project's history, so the date of a decision or event that has already happened is not a "
    "deadline and is never reported as unsupported. For each: the passage quoted verbatim, the problem in one "
    "sentence, and the smallest fix. At most five, most material first. When in doubt, report nothing.\n"
    # 9 Nov: the same rule as one clause of the list above let a saved package through. It said the
    # event was deliverable once one hour was covered, while its own checklist still had the trainer,
    # room and equipment to book. Each line reads well alone, so the check has to put them side by side.
    "4. READINESS. First find every sentence that says when the thing becomes ready or deliverable, or when "
    "something may be sent, launched or go ahead (\"one gap blocks it\", \"deliverable only when X\", \"send this "
    "only after X\"). Then read every checklist, action list and status table in the deliverable. A step on those "
    "lists that is still to be done, has to be done before the thing can happen (book, confirm, order, pay, sign, "
    "arrange), and that the sentence neither names nor covers means the two do not agree, even when each reads well "
    "alone. Report it under \"contradictions\": the sentence as rule_quote, the list item as conflicts_quote, and as "
    "the fix what else must be true, or that the sentence covers only that one gap. A sentence that points to the "
    "open items as a whole (\"until the open items below are done\") covers them, and a step that can only come "
    "after the thing happens is not part of it. At most two.\n"
    # 8 Nov (a client, an acquisition screen): the memo called a supplied one-time item
    # "undocumented" and the margin failure "conditional", and said two favourable answers
    # could reverse a recommendation a supplied 24% against a supplied 20% limit had fixed.
    "5. SUPPLIED, THEN DOUBTED OR UNDONE. Two things only. (a) The deliverable questions, hedges or makes "
    "conditional a fact, figure or rule the user supplied: calls it undocumented, unverified or unconfirmed, "
    "says a result holds \"only if\" it is right, or calls the user's rule \"a reading\", when nothing the "
    "user supplied contradicts it and the user did not ask for it to be tested or treated as a claim. Asking "
    "for the records behind it as later work is not this. (b) First find every sentence that says what could "
    "reverse or change a result or the recommendation. Then, for each result it speaks of that a supplied rule "
    "and a supplied figure fix (a threshold missed, a limit exceeded, a must-have failed): the sentence is wrong "
    "when it says answers, explanations or documents that leave that figure and that rule as they are could "
    "reverse, clear or change the result. "
    "Report each under \"gaps\": the passage quoted verbatim, the problem in one sentence, and as the fix the "
    "result stated as it stands, with only a different figure or a changed rule able to change it. At most four, "
    "and always the (b) sentence when there is one. "
    "Copy every quote exactly, one sentence or less. "
    "Return JSON: {\"findings\": [{\"id\": string, \"verdict\": \"carried\" | \"not_carried\" | \"not_applicable\", "
    "\"quote\": string, \"note\": string}], \"contradictions\": [{\"rule_quote\": string, \"conflicts_quote\": string, "
    "\"problem\": string, \"fix\": string}], \"gaps\": [{\"quote\": string, \"problem\": string, \"fix\": string}]}"
)


def _tables_block(tables: list[RecordedTable] | None) -> str:
    kept = [t for t in (tables or [])[:MAX_TABLES] if t.rows.strip()]
    if not kept:
        return ""
    return "TABLES ON RECORD THAT THE DELIVERABLE REPORTS ON (each row as it stands):\n" + "\n".join(
        f"### {t.label or 'Table'}\n{t.rows.strip()}" for t in kept
    ) + "\n\n"


def _note_quotes_block(quotes: list[str] | None) -> str:
    """5 Nov (a book test): the delivered review note quoted "I'm approving it at 2:30",
    as a problem still in the book, when the chapters beside it said 2pm."""
    kept = [" ".join(q.split()) for q in (quotes or [])[:MAX_NOTE_QUOTES] if q.strip()]
    if not kept:
        return ""
    return (
        "PASSAGES THE DOCUMENT'S OWN REVIEW NOTE QUOTES THAT THE REST OF THIS TEXT DOES NOT CONTAIN (found in code):\n"
        + "\n".join(f'- "{q}"' for q in kept)
        + "\nA note may quote an earlier draft or the brief, saying so. A note that presents one of these as what the "
        "document says now is a contradiction: report it, quoting the note's sentence and what the text says instead.\n\n"
    )


def build_prompt(
    inputs: PMInput,
    label: str,
    content: str,
    findings: list[AcceptedFinding],
    tables: list[RecordedTable] | None = None,
    note_quotes: list[str] | None = None,
    measured: list[MeasuredLine] | None = None,
) -> tuple[str, str]:
    rows = "\n".join(
        f"- {f.id}{f' ({f.stage_label})' if f.stage_label else ''}: {' '.join(f.finding.split())}"
        + (f" — suggested change: {' '.join(f.suggested_change.split())}" if f.suggested_change.strip() else "")
        + (f" — LENGTH DECIDED IN CODE: {' '.join(f.length_decided.split())}" if f.length_decided.strip() else "")
        for f in findings[:MAX_FINDINGS]
    )
    counts = measured_block(measured or [], "THE DELIVERABLE")
    facts = context_block(inputs)
    # 9 Nov (a finished package): the check was never shown the brief's constraints, so what the
    # brief required read as unsupported, and a date it never gave passed as ordinary.
    brief = (inputs.constraints or "").strip()
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"THE BRIEF'S CONSTRAINTS, AS THE USER SUPPLIED THEM:\n<<<\n{brief}\n>>>\n" if brief else "")
        + (f"{facts}\n" if facts else "")
        + f"\nACCEPTED FINDINGS:\n{rows or '(none)'}\n\n"
        + _tables_block(tables)
        + _note_quotes_block(note_quotes)
        + (f"{counts}\n\n" if counts else "")
        + f"THE DELIVERABLE — {label}:\n{clip_by_section(content, MAX_CHECK_CONTENT)[0]}"
    )
    return _INSTRUCTION, user


def _norm(text: str) -> str:
    text = re.sub(r"[*_`#>|]", "", text.replace("\\", "")).replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().lower().strip(" .\"'")


def _found(quote: str, *texts: str) -> bool:
    q = _norm(quote)
    return len(q) >= 8 and any(q in _norm(t) for t in texts)


def parse(
    raw: object, inputs: PMInput, content: str, findings: list[AcceptedFinding], tables: list[RecordedTable] | None = None,
) -> DeliverableCheck:
    """A verdict is kept only for a finding that was sent; "carried" only with its
    passage found in the text — without one it is not shown to be carried. A
    contradiction is kept only when both of its quotes are found."""
    if not isinstance(raw, dict):
        return DeliverableCheck()
    ids = {f.id for f in findings}
    checks: list[FindingCheck] = []
    for item in raw.get("findings") or []:
        if not isinstance(item, dict):
            continue
        fid = str(item.get("id") or "").strip()
        verdict = str(item.get("verdict") or "").strip().lower()
        if fid not in ids or verdict not in ("carried", "not_carried", "not_applicable") or any(c.id == fid for c in checks):
            continue
        quote = " ".join(str(item.get("quote") or "").split()).strip('"“”')[:400]
        if quote and not _found(quote, content):
            quote = ""
        if verdict == "carried" and not quote:
            # Said to be made, with nothing to show where: not shown.
            continue
        if verdict == "not_carried" and not quote and not " ".join(str(item.get("note") or "").split()):
            # Said to be missing, with no passage and no word of what is lacking (12 Nov): not shown either.
            continue
        checks.append(FindingCheck(id=fid, verdict=verdict, quote=quote, note=" ".join(str(item.get("note") or "").split())[:300]))
    # What the user supplied is a source a conflict may quote, the brief as much as a fact.
    record = " ".join([*(f.statement for f in (inputs.facts or [])), inputs.constraints or "", inputs.context or ""])
    # What a table on record says is a source a conflict may quote (4 Nov).
    on_record = "\n".join(t.rows for t in (tables or [])[:MAX_TABLES])
    contradictions: list[Contradiction] = []
    for item in (raw.get("contradictions") or [])[:MAX_CONTRADICTIONS]:
        if not isinstance(item, dict):
            continue
        rule = " ".join(str(item.get("rule_quote") or "").split()).strip('"“”')[:400]
        other = " ".join(str(item.get("conflicts_quote") or "").split()).strip('"“”')[:400]
        problem = " ".join(str(item.get("problem") or "").split())[:400]
        if not problem or not _found(rule, content) or not _found(other, content, record, on_record) or _norm(rule) == _norm(other):
            continue
        contradictions.append(Contradiction(rule_quote=rule, conflicts_quote=other, problem=problem, fix=" ".join(str(item.get("fix") or "").split())[:400]))
    # A follow-through gap has one passage to show: what it lacks is, by nature, not in the text.
    for item in (raw.get("gaps") or [])[:MAX_CONTRADICTIONS]:
        if not isinstance(item, dict):
            continue
        quote = " ".join(str(item.get("quote") or "").split()).strip('"“”')[:400]
        problem = " ".join(str(item.get("problem") or "").split())[:400]
        if not problem or not _found(quote, content):
            continue
        contradictions.append(Contradiction(rule_quote=quote, conflicts_quote="", problem=problem, fix=" ".join(str(item.get("fix") or "").split())[:400]))
    return DeliverableCheck(findings=checks, contradictions=contradictions)


async def check_deliverable(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    label: str,
    content: str,
    findings: list[AcceptedFinding],
    tables: list[RecordedTable] | None = None,
    note_quotes: list[str] | None = None,
    measured: list[MeasuredLine] | None = None,
) -> DeliverableCheck:
    if not content.strip():
        return DeliverableCheck()
    system, user = build_prompt(inputs, label, content, findings, tables, note_quotes, measured)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=3_000, model=model)
    parsed = parse(raw, inputs, content, findings, tables)
    parsed.read_chars = clip_by_section(content, MAX_CHECK_CONTENT)[1]
    parsed.total_chars = len(content.strip())
    return parsed
