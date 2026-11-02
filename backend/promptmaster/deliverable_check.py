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

from .llm_client import OpenRouterClient
from .project_context import context_block
from .schemas import PMInput

MAX_FINDINGS = 30
MAX_CONTRADICTIONS = 5


class AcceptedFinding(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    stage_label: str = Field(default="", max_length=200)
    finding: str = Field(default="", max_length=1_000)
    suggested_change: str = Field(default="", max_length=1_000)


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
    "rule applied to a case the text says has different, unknown costs. For each: the rule quoted verbatim, "
    "what it conflicts with quoted verbatim (from the deliverable, or the fact's own words), the problem in one "
    "sentence, and the smallest fix. At most five, most material first. Never report style, tone, length, "
    "missing detail or a point a careful reader would not call contradictory. When in doubt, report nothing.\n"
    "Copy every quote exactly, one sentence or less. "
    "Return JSON: {\"findings\": [{\"id\": string, \"verdict\": \"carried\" | \"not_carried\" | \"not_applicable\", "
    "\"quote\": string, \"note\": string}], \"contradictions\": [{\"rule_quote\": string, \"conflicts_quote\": string, "
    "\"problem\": string, \"fix\": string}]}"
)


def build_prompt(inputs: PMInput, label: str, content: str, findings: list[AcceptedFinding]) -> tuple[str, str]:
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
        f"THE DELIVERABLE — {label}:\n{content}"
    )
    return _INSTRUCTION, user


def _norm(text: str) -> str:
    text = re.sub(r"[*_`#>|]", "", text.replace("\\", "")).replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().lower().strip(" .\"'")


def _found(quote: str, *texts: str) -> bool:
    q = _norm(quote)
    return len(q) >= 8 and any(q in _norm(t) for t in texts)


def parse(raw: object, inputs: PMInput, content: str, findings: list[AcceptedFinding]) -> DeliverableCheck:
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
    contradictions: list[Contradiction] = []
    for item in (raw.get("contradictions") or [])[:MAX_CONTRADICTIONS]:
        if not isinstance(item, dict):
            continue
        rule = " ".join(str(item.get("rule_quote") or "").split()).strip('"“”')[:400]
        other = " ".join(str(item.get("conflicts_quote") or "").split()).strip('"“”')[:400]
        problem = " ".join(str(item.get("problem") or "").split())[:400]
        if not problem or not _found(rule, content) or not _found(other, content, record) or _norm(rule) == _norm(other):
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
) -> DeliverableCheck:
    if not content.strip():
        return DeliverableCheck()
    system, user = build_prompt(inputs, label, content, findings)
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=3_000, model=model)
    return parse(raw, inputs, content, findings)
