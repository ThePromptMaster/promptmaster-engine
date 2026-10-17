"""Is the objective met — judged from what the project holds, not from where
the workflow is (Sean, 6 Oct, "Second research test: Go reports objective met
despite an explicit blocker").

Go's "Objective complete" used to mean the last writing stage had text. A
research log that said the success criterion was "Not met", that no Hessian
had been computed, and that the work should pause for missing formulas was
non-empty, so the run ended "Objective met." This is the judgment that was
missing: one call, given the objective, the deliverable's text and what the
run actually executed, returns whether the objective is met, what blocks it,
and which work was performed versus only proposed.

Two guards in code, the same kind as `extract-figures` and `verify-sources`:
  - "met" needs a quote that occurs verbatim in the deliverable; without one
    it is "partly", never "met";
  - "performed" may name only steps the run really recorded; anything else
    the model calls done is moved to "proposed next".

Never an exit criterion: criteria stay pure functions (CLAUDE.md). This is
what Go must pass before it may say the objective is met.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from .agent_actions import ACTIONS_BY_KEY
from .llm_client import OpenRouterClient
from .project_context import CHECK_CONTEXT_MAX, brief_lines, context_block
from .schemas import PMInput

#: The deliverable text a check reads; the verdict and blockers of a long
#: log are in its opening and closing, so both ends are kept.
MAX_ASSESS_CONTENT = 40_000
MAX_BLOCKERS = 8
MAX_ITEMS = 12

BlockerKind = Literal["data_missing", "tool_missing", "source_missing", "needs_decision"]
Outcome = Literal["met", "not_met", "partly"]
Verdict = Literal["met", "not_met", "not_checked"]
MAX_CRITERIA = 12

_ASSESS_INSTRUCTION = (
    "You decide whether a PromptMaster project's OBJECTIVE is met, from what the "
    "project actually holds. Reaching the last stage of a workflow is not meeting "
    "the objective. A write-up that says the success criterion is not met, that a "
    "calculation was not performed, or that work should pause for missing inputs "
    "means the objective is NOT met, however complete the document looks. Judge "
    "the objective's own success criterion. List as blockers only concrete missing "
    "inputs or capabilities the text names. Separate work the RUN RECORD shows was "
    "performed from next steps that are only proposed. A finished report, plan or "
    "status pack meets an objective to produce it, even while the project it "
    "describes still has open work; that open work is not a reason it is unmet.\n\n"
    # 8 Oct production pass (TaskBoard): the objective said "stop and ask me
    # which date and price before drafting"; Go asked, the answer is an
    # accepted fact, and the check still called the objective unmet because
    # the deliverable was a draft rather than "a pause-and-ask".
    "An objective may say HOW the work is to be done as well as what it produces "
    "(\"ask me before drafting\", \"stop for my decision\", \"use only supplied facts\"). "
    "Such a requirement is met when the accepted facts or the run record show it was "
    "carried out — a decision the user recorded answers the question it required. Do "
    "not judge the finished deliverable against a step that belonged before it; judge "
    "the deliverable against what it was to contain. "
    # Q3a/Q3b (9 Oct): conditional results and AI passes do not stand in.
    "A result the deliverable labels as resting on an unverified assumption ('assumed, not "
    "verified', 'conditional on') does not meet the objective; nor does an AI pass where the "
    "objective requires people (independent human coders, participants, a laboratory "
    "measurement). "
    # 14 Oct (Sean, SUMMIT): Luis's request to count two testing days was
    # recorded as a requirement; the pack correctly refused it, and the check
    # called the objective unmet because the request was not carried out.
    "A request, suggestion or proposal made by someone in the project (\"Luis asks to count those "
    "days\", \"Omar proposes a budget increase\") is not a requirement of the objective, even when it "
    "is recorded as one. Never list it as a criterion to carry out. The deliverable handles it correctly "
    "when it reports the request and treats it as the accepted facts and approvals allow — declining or "
    "excluding it where it conflicts with them is correct, not a failure. Return JSON only."
)


class Blocker(BaseModel):
    need: str = Field(max_length=300)
    kind: BlockerKind = "data_missing"
    #: One question to the user that would supply it, in their terms (Sean, 13
    #: Oct, workshop: "PromptMaster left me figuring out what to provide next").
    ask: str = Field(default="", max_length=300)


class CriterionResult(BaseModel):
    """One requirement the check considered, with its verdict and basis (Sean,
    10 Oct, email 6.5: "The final verification should identify the saved
    artifact it assessed, the criteria considered, the results, and any
    remaining qualifications")."""
    requirement: str = Field(max_length=300)
    verdict: Verdict = "not_checked"
    #: Verbatim from the deliverable when "met"; else "" or why it could not be checked.
    basis: str = Field(default="", max_length=400)


class ObjectiveAssessment(BaseModel):
    outcome: Outcome
    #: One sentence: why.
    reason: str = Field(default="", max_length=600)
    #: Verbatim from the deliverable; required for "met".
    basis_quote: str = Field(default="", max_length=400)
    blockers: list[Blocker] = Field(default_factory=list, max_length=MAX_BLOCKERS)
    #: Work the run record shows was done, in the record's own words.
    performed: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    #: Next investigations or steps named but not done.
    proposed_next: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    #: Each requirement considered: the objective's parts, accepted requirements, constraints.
    criteria: list[CriterionResult] = Field(default_factory=list, max_length=MAX_CRITERIA)
    #: The model's own sentence when code overruled its "met" — kept for the
    #: record, never shown as the reason (11 Oct: "The objective is not met
    #: yet", followed by the model saying the brief satisfied the requirements).
    model_note: str = Field(default="", max_length=600)
    #: What was found unmet, by name: measured and carried-forward checks first.
    unmet: list[str] = Field(default_factory=list, max_length=MAX_CRITERIA + 30)


class RunStep(BaseModel):
    action_key: str = Field(max_length=80)
    execution_label: str | None = Field(default=None, max_length=40)
    output: str = Field(default="", max_length=600)


def _clip(text: str) -> str:
    text = text.strip()
    if len(text) <= MAX_ASSESS_CONTENT:
        return text
    half = MAX_ASSESS_CONTENT // 2
    return f"{text[:half]}\n[…the middle of the text is not shown…]\n{text[-half:]}"


def build_assessment_prompt(
    inputs: PMInput,
    deliverable_label: str,
    content: str,
    steps: list[RunStep],
    success_criterion: str = "",
    failed_checks: list[str] | None = None,
    measured: list[str] | None = None,
) -> tuple[str, str]:
    record = "\n".join(
        f"- S{i + 1}: {s.action_key} — {s.execution_label or 'no execution label'}"
        + (f" — {' '.join(s.output.split())[:200]}" if s.output.strip() else "")
        for i, s in enumerate(steps)
    ) or "- (no steps recorded)"
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"SUCCESS CRITERION, as set when the workflow was designed: {success_criterion}\n" if success_criterion.strip() else "")
        + (f"{brief}\n" if (brief := brief_lines(inputs)) else "")
        + (f"{context_block(inputs, limit=CHECK_CONTEXT_MAX)}\n" if context_block(inputs) else "")
        + f"\nRUN RECORD (what the autonomous run actually did; execution labels are derived from what happened):\n{record}\n\n"
        f"--- THE DELIVERABLE: {deliverable_label} ---\n{_clip(content)}\n--- END ---\n\n"
        + (
            # C2 (8 Oct): what the project's own checks found still wrong. A
            # finding carried forward is still a finding (Sean, sequence test).
            "STILL UNMET, as the project's own checks recorded (measured in code, or carried forward "
            "unresolved by a review). Each one means the objective is NOT met unless the deliverable "
            "above plainly shows it is fixed:\n" + "\n".join(f"- {c}" for c in failed_checks) + "\n\n"
            if failed_checks else ""
        )
        + (
            # 11 Oct (survey brief): the check said the saved brief "exceeds 200
            # words" by its own count. What code measured is the count.
            "MEASURED IN CODE AND MET (" + COUNTING_RULE + "). These counts are authoritative: do not "
            "count again and do not mark these requirements not met:\n"
            + "\n".join(f"- {m}" for m in measured) + "\n\n"
            if measured else ""
        )
        +         "Return JSON: {\n"
        '  "outcome": "met" | "not_met" | "partly",\n'
        '  "reason": "one sentence",\n'
        '  "basis_quote": "a short passage copied exactly from the deliverable that shows the outcome",\n'
        '  "blockers": [{"need": "exactly what is missing — with the value or limit it must meet when the recorded figures give one", '
        '"ask": "one question to the user that would supply it", "kind": "data_missing|tool_missing|source_missing|needs_decision"}],\n'
        '  "performed": ["S1", "S3"],\n'
        '  "proposed_next": ["each next step or investigation the text names but the record does not show done"],\n'
        '  "criteria": [{"requirement": "one thing the objective, an accepted requirement or a constraint asks for", '
        '"verdict": "met" | "not_met" | "not_checked", "basis": "for met: a sentence copied exactly from the deliverable that shows it; '
        'otherwise why"}]\n'
        "}\n"
        # 10 Oct (Sean, emails 3 and 8): a heading is not evidence; a length you
        # cannot see (pages when printed) is not checked, and saying so is honest.
        # 13 Oct (Sean, workshop): "For 20 lunches within $240, clearly explain
        # that we need a confirmed price of $12 per person or less."
        "A blocker is actionable: where the recorded figures fix what the missing value must be, say so with "
        "the calculation (a confirmed lunch price of $12 per person or less: $240 approved / 20 attendees), "
        "and ask for exactly that value. Use only figures the record gives.\n"
        "List each requirement separately in \"criteria\" — every part of the objective, every accepted "
        "requirement and constraint — at most 12. Mark one \"not_checked\" when the text alone cannot show it "
        "(how many pages it prints to, how it looks, anything outside the text). A heading is not a basis.\n"
        '"performed" lists ONLY step ids from the RUN RECORD whose execution label shows work was done.'
    )
    return _ASSESS_INSTRUCTION, user


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[*_`#>]", "", text).split()).lower()


def _is_evidence(quote: str, content: str) -> bool:
    """A passage copied from the deliverable that says something, not one of its
    headings (Sean, 10 Oct, email 8: the completion message quoted
    "## 1. Pre-arrival preparation" as the evidence the objective was met)."""
    if not quote or _norm(quote) not in _norm(content):
        return False
    if quote.lstrip().startswith("#"):
        return False
    for line in content.splitlines():
        if line.lstrip().startswith("#") and _norm(line) == _norm(quote):
            return False
    return True


#: How code counts, said to the model wherever a count is (frontend `COUNTING_RULE`).
COUNTING_RULE = "words of the text itself, not counting headings or a word-count note; labelled assumptions count"

_NUMBER_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve".split()
)}
_KINDS = ("word", "section", "question")


def _numbers(text: str) -> set[int]:
    found = {int(n) for n in re.findall(r"\d{1,5}", text)}
    found |= {_NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", text.lower()) if w in _NUMBER_WORDS}
    return found


#: The parts a requirement can name; mirrors `SUBJECTS` in `measurable.ts`.
_PARTS = (
    "announcement", "faq", "summary", "email", "letter", "memo", "abstract", "post", "report",
    "description", "bio", "introduction", "overview", "invitation", "briefing", "press release", "statement", "answer",
)


def _measured_for(requirement: str, measured: list[str]) -> str | None:
    """The measurement in code a requirement is about: same kind (words,
    sections, questions), the same number, and the same part. 12 Oct (Sean,
    Diligence): a count of something else at the same limit overruled the
    model's "the summary is over 250 words"."""
    req = requirement.lower()
    nums = _numbers(req)
    for m in measured:
        label = m.split(" — ")[0].lower()
        subject = label.split(":", 1)[0].strip() if ":" in label else ""
        named = {p for p in _PARTS if re.search(rf"\b{p}", req)}
        if named and subject not in named and subject != "the deliverable":
            continue
        if any(k in req and k in label for k in _KINDS) and nums & _numbers(label):
            return m
    return None


#: The model called the objective met but could not quote a passage showing it.
NO_EVIDENCE_REASON = (
    "The check found every requirement met but could not point to a passage in the deliverable "
    "that shows it, so it is not recorded as met."
)


def unmet_items(criteria: list[CriterionResult], failed_checks: list[str]) -> list[str]:
    """Each thing found unmet, measured failures first: they are facts, not opinions."""
    items = [" ".join(c.split()) for c in failed_checks if c.strip()]
    for c in criteria:
        if c.verdict == "not_met":
            why = c.basis.rstrip(". ")
            items.append(f"{c.requirement.rstrip('. ')}{f' — {why}' if why else ''}")
    return items


def unmet_reason(items: list[str]) -> str:
    """"Not met: at most 200 words — measured 214 words; no invented company
    details — names "Acme Corp"." Empty when nothing was named."""
    return f"Not met: {'; '.join(items[:4])}." if items else ""


def _needs_evidence_retry(result: object, parsed: ObjectiveAssessment, failed_checks: list[str] | None) -> bool:
    """The model said "met" and the only thing wrong was its quote."""
    return (
        isinstance(result, dict)
        and result.get("outcome") == "met"
        and parsed.outcome == "partly"
        and not failed_checks
        and not any(c.verdict == "not_met" for c in parsed.criteria)
    )


#: Sent once when a "met" came back without a passage copied from the deliverable.
EVIDENCE_RETRY = (
    "\n\nYOUR PREVIOUS ANSWER said \"met\" but its basis_quote is not a sentence that occurs in the "
    "deliverable exactly as written (a heading does not count). Answer again. For \"met\", copy one "
    "sentence from the deliverable character for character into basis_quote, and do the same for each "
    "met criterion's basis. If no sentence shows it, the outcome is not \"met\"."
)


#: Execution labels in the user's words; mirrors `LABEL_TEXT` in `lib/agent/labels.ts`.
EXECUTION_TEXT = {
    "discussed": "analyzed", "designed": "draft written", "code_written": "code written, not run",
    "code_executed": "code executed", "simulation_run": "simulation run", "result_interpreted": "result interpreted",
    "blocked": "could not continue",
}

_REQUEST = re.compile(r"\b(?:asks?|asked|requests?|requested|suggests?|suggested|proposes?|proposed|proposal|wants?|would like)\b", re.I)
_WORDS = re.compile(r"[a-z0-9]{3,}")
_STOP = {"the", "and", "for", "that", "this", "with", "can", "still", "toward", "towards", "those", "these", "from", "are", "was", "has", "have"}


def _content_words(text: str) -> set[str]:
    return {w for w in _WORDS.findall(text.lower()) if w not in _STOP}


_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")


def request_facts(inputs: PMInput) -> list[str]:
    """The requests, suggestions and proposals on record: in the accepted facts,
    and in the source material (17 Oct, Sean: Luis's request lived in the
    update text, not only in a fact). Not the objective or constraints — those
    are the user's own words, and "the sponsor asks for three sections" there
    is the brief."""
    facts = [f.statement for f in (inputs.facts or []) if _REQUEST.search(f.statement)]
    context = [" ".join(t.split()) for t in _SENTENCE.split(inputs.context or "") if _REQUEST.search(t)]
    return [*facts, *(c[:400] for c in context if c and c not in facts)][:40]


_MONTH_DAY = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*(?:and|&|to|through|–|—|-)\s*(\d{1,2}))?\b",
    re.I,
)
#: A criterion that holds the line against a request ("Exclude November 16–17
#: from the count") is the rule, not the request: its failure is real.
_HOLDS_LINE = re.compile(r"\b(?:never|do not|don't|must not|may not|exclud\w*|without|reject\w*|declin\w*|refus\w*|only)\b", re.I)
_NAME_BEFORE_ASK = re.compile(r"\b([A-Z][a-z]{2,})(?:'s)?\s+(?:\w+\s+){0,2}(?:asks?|asked|requests?|requested|suggests?|suggested|proposes?|proposed|wants?|would like)\b")


def _subject(text: str) -> set[str]:
    """The specific dates and figures a sentence is about: "11-16", "11-17", "86000"."""
    out: set[str] = set()
    for m in _MONTH_DAY.finditer(text):
        month = m.group(0)[:3].lower()
        out.update(f"{month}-{d}" for d in m.groups() if d)
    out.update(f"#{int(a)}" if a == int(a) else f"#{a}" for a in _amounts(re.sub(_MONTH_DAY, " ", text)) if a >= 10)
    return out


def _is_request(requirement: str, requests: list[str]) -> bool:
    """The criterion restates a recorded request ("Count the November 16 and 17
    testing days toward the five" for "Luis asks to count those two days toward
    the required five testing days"), or reads as one itself.

    17 Oct (Sean, SUMMIT): matched only on shared words, a reworded request
    ("Decide whether Luis's days count") or one about the request's own dates
    slipped through. It also matches on the request's specific dates or
    figures, or on the person who asked — but never a criterion that holds the
    line against it ("exclude November 16–17"), and never a rule that names
    none of the request's specifics ("five testing days before launch")."""
    if _REQUEST.search(requirement):
        return True
    words = _content_words(requirement)
    if len(words) >= 4 and any(len(words & _content_words(r)) >= max(4, len(words) // 2) for r in requests):
        return True
    if _HOLDS_LINE.search(requirement):
        return False
    subject = _subject(requirement)
    for r in requests:
        shared = words & _content_words(r)
        theirs = _subject(r)
        if theirs and subject and len(subject & theirs) >= min(2, len(theirs)) and shared:
            return True
        if any(n in requirement for n in _NAME_BEFORE_ASK.findall(r)) and shared:
            return True
    return False


def set_aside_requests(items: list[str] | None, requests: list[str]) -> tuple[list[str], list[str]]:
    """`items` split into those that stand and those that only restate a request."""
    kept, declined = [], []
    for item in items or []:
        (declined if requests and _is_request(item, requests) else kept).append(item)
    return kept, declined


_AMOUNT = re.compile(r"(?<![\w.])\$?(\d[\d,]*(?:\.\d+)?)(?![\d])")
#: A figure with what it is held to: "$12 per person or less", "under $240".
_FIGURE_PHRASE = re.compile(
    r"(?:\s*(?:of|at|under|below|above|over|no more than|at most|at least|up to|within)\s+)?"
    r"\$?\d[\d,]*(?:\.\d+)?(?:\s*(?:per|a|an|each)\s+\w+)?(?:\s+or\s+(?:less|fewer|more|lower|higher|under|below))?",
    re.I,
)


def _amounts(text: str) -> set[float]:
    out: set[float] = set()
    for m in _AMOUNT.finditer(text):
        try:
            out.add(float(m.group(1).replace(",", "")))
        except ValueError:
            pass
    return out


def _derivable(value: float, record: set[float]) -> bool:
    """On the record, or one step of arithmetic on two of its figures."""
    if any(abs(value - r) < 0.005 for r in record):
        return True
    nums = sorted(record)[:60]
    for a in nums:
        for b in nums:
            for v in (a + b, a - b, a * b, a / b if b else None):
                if v is not None and abs(v - value) < 0.005:
                    return True
    return False


def _figures_from_record(text: str, record: set[float]) -> str:
    """`text` with any figure removed that the record neither gives nor yields in one step."""
    def keep(m: re.Match[str]) -> str:
        found = _amounts(m.group(0))
        return m.group(0) if all(_derivable(v, record) for v in found) else ""
    out = _FIGURE_PHRASE.sub(keep, text)
    return re.sub(r"\s+([,.;:)])", r"\1", re.sub(r"\(\s*\)|\s{2,}", " ", out)).strip()


def record_text(inputs: PMInput) -> str:
    """Where a blocker's figures may come from: the brief, the context and the accepted facts."""
    facts = "\n".join(f.statement for f in (inputs.facts or []))
    return "\n".join([inputs.objective, inputs.constraints, inputs.context or "", facts])


def parse_assessment(
    result: object,
    content: str,
    steps: list[RunStep],
    failed_checks: list[str] | None = None,
    measured: list[str] | None = None,
    requests: list[str] | None = None,
    record: str = "",
) -> ObjectiveAssessment:
    if not isinstance(result, dict):
        return ObjectiveAssessment(outcome="partly", reason="The check did not come back in a usable form.")
    # A carried-forward finding that only restates a request is not a failure
    # (17 Oct, Sean, SUMMIT: "Luis's days not counted" kept the objective unmet).
    failed_checks, declined = set_aside_requests(failed_checks, requests or [])
    claimed = result.get("outcome") if result.get("outcome") in ("met", "not_met", "partly") else "partly"
    outcome = claimed
    quote = " ".join(str(result.get("basis_quote") or "").split())[:400]
    quoted = _is_evidence(quote, content)
    if not quoted:
        quote = ""
    # "Met" needs the deliverable to show it; a claim without a verbatim
    # quote is only "partly".
    if outcome == "met" and not quoted:
        outcome = "partly"
    # A check the project measured or recorded as unmet is not overruled by
    # the model's reading (C2, 8 Oct).
    if outcome == "met" and failed_checks:
        outcome = "partly"

    blockers: list[Blocker] = []
    record_numbers = _amounts(f"{record}\n{content}")
    for b in result.get("blockers") or []:
        if not isinstance(b, dict):
            continue
        need = " ".join(str(b.get("need") or "").split())[:300]
        ask = " ".join(str(b.get("ask") or "").split())[:300]
        kind = b.get("kind") if b.get("kind") in ("data_missing", "tool_missing", "source_missing", "needs_decision") else "data_missing"
        if need:
            # A figure the record does not give, and no one step of arithmetic
            # on its figures gives, is not shown: a threshold the model made
            # up would send the user after the wrong number.
            need, ask = _figures_from_record(need, record_numbers), _figures_from_record(ask, record_numbers)
            # A decision about a request is not the user's to make for the
            # objective: the deliverable reports how the request was handled.
            if kind == "needs_decision" and requests and (_is_request(need, requests) or (ask and _is_request(ask, requests))):
                declined.append(need)
                continue
            blockers.append(Blocker(need=need, kind=kind, ask=ask))
    if outcome == "met":
        blockers = []

    # Performed: only ids from the record, and only steps that did something.
    done_labels = {"code_written", "code_executed", "simulation_run", "result_interpreted", "designed"}
    performed: list[str] = []
    proposed: list[str] = []
    # In the user's words, not the registry's (14 Oct, Sean: "Done: recheck_stage (designed)").
    for item in result.get("performed") or []:
        m = re.fullmatch(r"\s*S(\d+)\s*", str(item))
        idx = int(m.group(1)) - 1 if m else -1
        if m:
            # A step id: kept only if the record has it and it did something.
            if 0 <= idx < len(steps) and (steps[idx].execution_label or "") in done_labels:
                s = steps[idx]
                action = ACTIONS_BY_KEY.get(s.action_key)
                text = f"{action.label if action else s.action_key} ({EXECUTION_TEXT.get(s.execution_label or '', s.execution_label)})"
                if text not in performed:
                    performed.append(text)
        elif str(item).strip():
            # Claimed as done, not in the record: it is at most a proposal.
            proposed.append(" ".join(str(item).split())[:300])
    for item in result.get("proposed_next") or []:
        text = " ".join(str(item).split())[:300]
        if text and text not in proposed:
            proposed.append(text)

    criteria: list[CriterionResult] = []
    overruled: list[str] = []
    for c in result.get("criteria") or []:
        if not isinstance(c, dict):
            continue
        requirement = " ".join(str(c.get("requirement") or "").split())[:300]
        if not requirement:
            continue
        verdict = c.get("verdict") if c.get("verdict") in ("met", "not_met", "not_checked") else "not_checked"
        basis = " ".join(str(c.get("basis") or "").split())[:400]
        # "Met" needs a sentence the deliverable says; without one it was not shown.
        if verdict == "met" and not _is_evidence(basis, content):
            verdict, basis = "not_checked", "No passage in the deliverable shows it."
        # A count code made is the count (11 Oct): the model's own reading of
        # a length or a number of sections does not overrule it.
        counted = _measured_for(requirement, measured or [])
        # A request is not the objective's to carry out (14 Oct, SUMMIT): a
        # verdict that it was "not met" is set aside, in code.
        if verdict == "not_met" and _is_request(requirement, requests or []):
            declined.append(requirement)
            verdict, basis = "not_checked", "A request by someone in the project, not a requirement; the deliverable reports how it was handled."
        elif counted and verdict != "met":
            overruled.append(f"{requirement} ({'said not met' if verdict == 'not_met' else 'not checked'})")
            verdict, basis = "met", f"Measured in code: {counted}"
        criteria.append(CriterionResult(requirement=requirement, verdict=verdict, basis=basis))
    # A requirement the check found unmet is a reason the objective is not met.
    if outcome == "met" and any(c.verdict == "not_met" for c in criteria):
        outcome = "partly"
    said = " ".join(str(result.get("reason") or "").split())[:600]
    # "Not met" with no requirement named, whose one reason is a count code
    # made and found met ("the brief exceeds 200 words" at 187): a miscount.
    if claimed != "met" and not overruled and not any(c.verdict == "not_met" for c in criteria):
        counted = _measured_for(said, measured or [])
        if counted:
            overruled.append(f"{said} (measured in code: {counted})")
    # Every requirement it found unmet was one code measured as met: its
    # verdict rested on a miscount. Met when it can show the text; else partly.
    if (
        claimed != "met" and (overruled or declined) and not failed_checks and not blockers
        and not any(c.verdict == "not_met" for c in criteria)
    ):
        outcome = "met" if quoted else "partly"

    reason, note = said or "No reason was given.", ""
    if overruled:
        said = f"{said} [Overruled by the count made in code: {'; '.join(overruled)}.]".strip()
        if outcome == "met":
            reason, note = "Met: every requirement holds; the measured ones were counted in code.", said
    if declined:
        said = f"{said} [Set aside as a request, not a requirement: {'; '.join(declined)}.]".strip()
        if outcome == "met" and not overruled:
            reason, note = "Met: every requirement holds; a request someone made is reported, not carried out.", said
    unmet = unmet_items(criteria, failed_checks or []) if outcome != "met" else []
    # The model's own "not met" with nothing named is still a thing unmet, in its words.
    if outcome != "met" and not unmet and claimed != "met" and not overruled and not declined and said:
        unmet = [said.rstrip(". ")]
    if outcome != "met":
        named = unmet_reason(unmet)
        if named:
            # What failed, in the record's words — never the model's summary
            # of a brief it called fine (11 Oct, survey brief).
            reason, note = named, said
        elif claimed == "met" or overruled:
            reason, note = NO_EVIDENCE_REASON, said

    return ObjectiveAssessment(
        outcome=outcome,
        criteria=criteria[:MAX_CRITERIA],
        model_note=note,
        unmet=unmet,
        reason=reason[:600],
        basis_quote=quote,
        blockers=blockers[:MAX_BLOCKERS],
        performed=performed[:MAX_ITEMS],
        proposed_next=proposed[:MAX_ITEMS],
    )


async def assess_objective(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    deliverable_label: str,
    content: str,
    steps: list[RunStep],
    success_criterion: str = "",
    failed_checks: list[str] | None = None,
    measured: list[str] | None = None,
) -> ObjectiveAssessment:
    requests = request_facts(inputs)
    # The check is not shown a carried-forward finding that only restates a request.
    failed_checks = set_aside_requests(failed_checks, requests)[0]
    system, user = build_assessment_prompt(inputs, deliverable_label, content, steps, success_criterion, failed_checks, measured)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_600, model=model)
    parsed = parse_assessment(result, content, steps, failed_checks, measured, requests, record_text(inputs))
    # A "met" lost only for want of a quote is asked once more before it can
    # pause a run (11 Oct: the run stopped on "not met" for exactly this).
    if _needs_evidence_retry(result, parsed, failed_checks):
        again, _usage = await client.generate_json(
            prompt=user + EVIDENCE_RETRY, system=system, temperature=0, max_tokens=1_600, model=model
        )
        parsed = parse_assessment(again, content, steps, failed_checks, measured, requests, record_text(inputs))
    return parsed
