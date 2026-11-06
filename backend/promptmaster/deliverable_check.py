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
    "You check a finished deliverable for two things, and nothing else.\n"
    "1. ACCEPTED FINDINGS. Each was accepted earlier, so the deliverable was meant to make its suggested "
    "change. For each, by its id: \"carried\" when the deliverable now does what the suggested change asks "
    "(quote the passage that shows it); \"not_carried\" when the deliverable still has the problem or lacks "
    "the change (quote the passage that still has it, if there is one, and say in a few words what is "
    "missing); \"not_applicable\" when the finding is about another document and has no bearing on this one. "
    "A finding a later accepted fact or requirement overrides is \"not_applicable\".\n"
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
    "what it conflicts with quoted verbatim (from the deliverable, or the fact's own words), the problem in one "
    "sentence, and the smallest fix. At most five, most material first. Never report style, tone, length, "
    "missing detail or a point a careful reader would not call contradictory. When in doubt, report nothing.\n"
    "Copy every quote exactly, one sentence or less. "
    "Return JSON: {\"findings\": [{\"id\": string, \"verdict\": \"carried\" | \"not_carried\" | \"not_applicable\", "
    "\"quote\": string, \"note\": string}], \"contradictions\": [{\"rule_quote\": string, \"conflicts_quote\": string, "
    "\"problem\": string, \"fix\": string}]}"
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
) -> tuple[str, str]:
    rows = "\n".join(
        f"- {f.id}{f' ({f.stage_label})' if f.stage_label else ''}: {' '.join(f.finding.split())}"
        + (f" — suggested change: {' '.join(f.suggested_change.split())}" if f.suggested_change.strip() else "")
        for f in findings[:MAX_FINDINGS]
    )
    facts = context_block(inputs)
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"{facts}\n" if facts else "")
        + f"\nACCEPTED FINDINGS:\n{rows or '(none)'}\n\n"
        + _tables_block(tables)
        + _note_quotes_block(note_quotes)
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
        checks.append(FindingCheck(id=fid, verdict=verdict, quote=quote, note=" ".join(str(item.get("note") or "").split())[:300]))
    record = " ".join(f.statement for f in (inputs.facts or []))
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
) -> DeliverableCheck:
    if not content.strip():
        return DeliverableCheck()
    system, user = build_prompt(inputs, label, content, findings, tables, note_quotes)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=3_000, model=model)
    parsed = parse(raw, inputs, content, findings, tables)
    parsed.read_chars = clip_by_section(content, MAX_CHECK_CONTENT)[1]
    parsed.total_chars = len(content.strip())
    return parsed
