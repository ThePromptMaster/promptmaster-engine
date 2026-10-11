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

from .llm_client import OpenRouterClient
from .project_context import context_block
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
    "performed from next steps that are only proposed.\n\n"
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
    "measurement). Return JSON only."
)


class Blocker(BaseModel):
    need: str = Field(max_length=300)
    kind: BlockerKind = "data_missing"


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
) -> tuple[str, str]:
    record = "\n".join(
        f"- S{i + 1}: {s.action_key} — {s.execution_label or 'no execution label'}"
        + (f" — {' '.join(s.output.split())[:200]}" if s.output.strip() else "")
        for i, s in enumerate(steps)
    ) or "- (no steps recorded)"
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"SUCCESS CRITERION, as set when the workflow was designed: {success_criterion}\n" if success_criterion.strip() else "")
        + (f"{context_block(inputs, limit=4_000)}\n" if (inputs.context.strip() or inputs.facts) else "")
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
        + 
        "Return JSON: {\n"
        '  "outcome": "met" | "not_met" | "partly",\n'
        '  "reason": "one sentence",\n'
        '  "basis_quote": "a short passage copied exactly from the deliverable that shows the outcome",\n'
        '  "blockers": [{"need": "exactly what is missing", "kind": "data_missing|tool_missing|source_missing|needs_decision"}],\n'
        '  "performed": ["S1", "S3"],\n'
        '  "proposed_next": ["each next step or investigation the text names but the record does not show done"],\n'
        '  "criteria": [{"requirement": "one thing the objective, an accepted requirement or a constraint asks for", '
        '"verdict": "met" | "not_met" | "not_checked", "basis": "for met: a sentence copied exactly from the deliverable that shows it; '
        'otherwise why"}]\n'
        "}\n"
        # 10 Oct (Sean, emails 3 and 8): a heading is not evidence; a length you
        # cannot see (pages when printed) is not checked, and saying so is honest.
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


def parse_assessment(
    result: object, content: str, steps: list[RunStep], failed_checks: list[str] | None = None
) -> ObjectiveAssessment:
    if not isinstance(result, dict):
        return ObjectiveAssessment(outcome="partly", reason="The check did not come back in a usable form.")
    outcome = result.get("outcome") if result.get("outcome") in ("met", "not_met", "partly") else "partly"
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
        result = {**result, "reason": f"Still unmet: {'; '.join(failed_checks[:3])}"}

    blockers: list[Blocker] = []
    for b in result.get("blockers") or []:
        if not isinstance(b, dict):
            continue
        need = " ".join(str(b.get("need") or "").split())[:300]
        kind = b.get("kind") if b.get("kind") in ("data_missing", "tool_missing", "source_missing", "needs_decision") else "data_missing"
        if need:
            blockers.append(Blocker(need=need, kind=kind))
    if outcome == "met":
        blockers = []

    # Performed: only ids from the record, and only steps that did something.
    done_labels = {"code_written", "code_executed", "simulation_run", "result_interpreted", "designed"}
    performed: list[str] = []
    proposed: list[str] = []
    for item in result.get("performed") or []:
        m = re.fullmatch(r"\s*S(\d+)\s*", str(item))
        idx = int(m.group(1)) - 1 if m else -1
        if m:
            # A step id: kept only if the record has it and it did something.
            if 0 <= idx < len(steps) and (steps[idx].execution_label or "") in done_labels:
                s = steps[idx]
                text = f"{s.action_key} ({s.execution_label})"
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
        criteria.append(CriterionResult(requirement=requirement, verdict=verdict, basis=basis))
    # A requirement the check found unmet is a reason the objective is not met.
    if outcome == "met" and any(c.verdict == "not_met" for c in criteria):
        outcome = "partly"

    return ObjectiveAssessment(
        outcome=outcome,
        criteria=criteria[:MAX_CRITERIA],
        reason=" ".join(str(result.get("reason") or "").split())[:600] or "No reason was given.",
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
) -> ObjectiveAssessment:
    system, user = build_assessment_prompt(inputs, deliverable_label, content, steps, success_criterion, failed_checks)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_600, model=model)
    return parse_assessment(result, content, steps, failed_checks)
