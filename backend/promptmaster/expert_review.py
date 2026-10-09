"""The package Go prepares when a step needs an expert's judgment (Q3a).

Sean, 9 Oct: "For physics, 'ask a physicist' should identify a specific
technical issue, the checks available or already attempted, and which next
actions depend on resolving it … When expert review is necessary,
PromptMaster should prepare a concise package containing the question,
assumptions, derivation or computation, evidence, unresolved issue, and
specific judgment requested."

One call, given the saved record and the issue Go is stuck on. Two guards in
code, of the same kind as `objective_assessment`:
  - every piece of working the package cites must quote the saved record
    verbatim; a quote not found there is dropped, so the package never
    presents a derivation the project does not hold;
  - an execution label is the record's, not the model's: "executed" only
    where the quote comes from a document that records an executed run.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .project_context import context_block
from .schemas import PMInput

MAX_RECORD = 60_000
MAX_ITEMS = 8

AssumptionStatus = Literal["accepted", "assumed"]
WorkLabel = Literal["executed", "derived", "proposed"]

_INSTRUCTION = (
    "You prepare an EXPERT REVIEW PACKAGE for a PromptMaster research project that has "
    "reached a point only an expert's judgment can settle. The reader is a specialist "
    "who has not seen the project: give them exactly what they need to judge, and "
    "nothing they must dig for. Use only what the saved record below contains. Do not "
    "solve the issue yourself and do not present a guess as established. Every piece "
    "of working you cite must be copied exactly from the saved record. Say which "
    "assumptions the project has accepted and which are only assumed. Name the one "
    "specific judgment requested, phrased so it can be answered, and the next steps "
    "that depend on it. Return JSON only."
)


class PackageAssumption(BaseModel):
    text: str = Field(max_length=400)
    status: AssumptionStatus = "assumed"


class PackageWork(BaseModel):
    #: Copied verbatim from the saved record.
    quote: str = Field(max_length=1_200)
    #: Which saved document it is from.
    source: str = Field(default="", max_length=200)
    label: WorkLabel = "derived"


class ExpertPackage(BaseModel):
    question: str = Field(max_length=600)
    assumptions: list[PackageAssumption] = Field(default_factory=list, max_length=MAX_ITEMS)
    working: list[PackageWork] = Field(default_factory=list, max_length=MAX_ITEMS)
    evidence: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    #: Checks already made or available, and what they showed.
    checks: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    unresolved: str = Field(max_length=800)
    judgment_requested: str = Field(max_length=600)
    depends_on_it: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)


class RecordDocument(BaseModel):
    label: str = Field(max_length=200)
    text: str = Field(max_length=200_000)
    #: The document records code that actually ran (an executed run's output).
    executed: bool = False


def _clip(text: str, limit: int) -> str:
    text = text.strip()
    return text if len(text) <= limit else f"{text[: limit // 2]}\n[…]\n{text[-limit // 2:]}"


def build_package_prompt(inputs: PMInput, issue: str, stage_label: str, documents: list[RecordDocument]) -> tuple[str, str]:
    per_doc = max(2_000, MAX_RECORD // max(len(documents), 1))
    record = "\n\n".join(
        f"--- SAVED: {d.label}{' (records executed code)' if d.executed else ''} ---\n{_clip(d.text, per_doc)}\n--- END {d.label} ---"
        for d in documents
    ) or "(nothing saved yet)"
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"{context_block(inputs, limit=4_000)}\n" if (inputs.context.strip() or inputs.facts) else "")
        + f"\nWHERE THE WORK STOPPED: {stage_label}\n"
        f"THE ISSUE THAT NEEDS AN EXPERT: {issue}\n\n"
        f"THE SAVED RECORD:\n{record}\n\n"
        "Return JSON: {\n"
        '  "question": "the technical question, in one or two sentences",\n'
        '  "assumptions": [{"text": "…", "status": "accepted|assumed"}],\n'
        '  "working": [{"quote": "copied exactly from the saved record", "source": "which saved document", "label": "executed|derived|proposed"}],\n'
        '  "evidence": ["what supports or bears on it, from the record"],\n'
        '  "checks": ["checks already made or available, and what they showed"],\n'
        '  "unresolved": "exactly what is not settled, and why the record cannot settle it",\n'
        '  "judgment_requested": "the one specific judgment the expert is asked for",\n'
        '  "depends_on_it": ["each next step that waits on that judgment"]\n'
        "}"
    )
    return _INSTRUCTION, user


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[*_`#>$\\]", "", text).split()).lower()


def _items(raw: object, limit: int = 400) -> list[str]:
    out: list[str] = []
    for item in raw if isinstance(raw, list) else []:
        text = " ".join(str(item).split())[:limit]
        if text and text not in out:
            out.append(text)
    return out[:MAX_ITEMS]


def parse_package(result: object, issue: str, documents: list[RecordDocument]) -> ExpertPackage:
    if not isinstance(result, dict):
        result = {}
    working: list[PackageWork] = []
    for w in result.get("working") or []:
        if not isinstance(w, dict):
            continue
        quote = " ".join(str(w.get("quote") or "").split())[:1_200]
        if not quote:
            continue
        # Never working the project does not hold.
        holder = next((d for d in documents if _norm(quote) in _norm(d.text)), None)
        if holder is None:
            continue
        label = w.get("label") if w.get("label") in ("executed", "derived", "proposed") else "derived"
        # "Executed" is the record's to say, not the model's.
        if label == "executed" and not holder.executed:
            label = "derived"
        working.append(PackageWork(quote=quote, source=holder.label, label=label))
    assumptions = [
        PackageAssumption(text=" ".join(str(a.get("text") or "").split())[:400], status=a.get("status") if a.get("status") in ("accepted", "assumed") else "assumed")
        for a in (result.get("assumptions") or []) if isinstance(a, dict) and str(a.get("text") or "").strip()
    ][:MAX_ITEMS]
    return ExpertPackage(
        question=" ".join(str(result.get("question") or issue).split())[:600] or issue[:600],
        assumptions=assumptions,
        working=working[:MAX_ITEMS],
        evidence=_items(result.get("evidence")),
        checks=_items(result.get("checks")),
        unresolved=" ".join(str(result.get("unresolved") or issue).split())[:800],
        judgment_requested=" ".join(str(result.get("judgment_requested") or "").split())[:600] or f"Your judgment on: {issue[:500]}",
        depends_on_it=_items(result.get("depends_on_it")),
    )


async def prepare_expert_package(
    client: OpenRouterClient, model: str | None, inputs: PMInput, issue: str, stage_label: str, documents: list[RecordDocument]
) -> ExpertPackage:
    system, user = build_package_prompt(inputs, issue, stage_label, documents)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_800, model=model)
    return parse_package(result, issue, documents)
