"""Is an answer about the record borne out by the record? (L-65, 9 Oct)

An answer to Go becomes an accepted fact, and accepted facts outrank what the
stages say: the user decides values and settles conflicts. But an answer can
also be a *claim about the record* — "the Experiment run record contains
S_5 = 12" — and on the production replay of the sequence test that claim was
wrong (Experiment had marked the check "not run"; it was done in Analysis).
Go accepted it, and a repair rewrote the record to match.

So before an answer is recorded, it is read against the saved documents. Only
a statement about what a document says, contains or shows is checked —
decisions, preferences and new values are the user's and are never questioned
here. A contradiction is kept only when its quote is verbatim in the document
it names; otherwise there is nothing to show the user, and the answer is
recorded as it stands. The user then decides: record it anyway, or edit it.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient


class AnswerDocument(BaseModel):
    label: str = Field(max_length=200)
    version: int | None = None
    text: str = Field(default="", max_length=200_000)


class CheckAnswerRequest(BaseModel):
    question: str = Field(default="", max_length=4_000)
    answer: str = Field(min_length=1, max_length=8_000)
    documents: list[AnswerDocument] = Field(default_factory=list, max_length=40)
    model: str = ""


class CheckAnswerResponse(BaseModel):
    contradicts: bool
    document: str = ""
    version: int | None = None
    quote: str = ""
    claim: str = ""
    explanation: str = ""


_INSTRUCTION = (
    "You check one answer a user gave to a question, against the project's saved documents. "
    "Look ONLY at statements in the answer about what a saved document says, contains, records or shows "
    "(\"the Experiment record contains S_5 = 12\", \"the FAQ already lists the price\"). "
    "Ignore decisions, choices, preferences, instructions and new values the user is setting: those are "
    "theirs to make and are never contradicted by the documents. "
    "If such a statement is contradicted by a saved document, report it: the document's label exactly as "
    "given, a quote copied verbatim from that document (one line or sentence, no paraphrase), and what the "
    "answer claims. If nothing is contradicted, or you are not sure, say it is not contradicted.\n"
    "Return JSON: {\"contradicts\": boolean, \"document\": string, \"quote\": string, \"claim\": string, "
    "\"explanation\": string}"
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\\", "")).strip().lower()


def build_prompt(req: CheckAnswerRequest) -> tuple[str, str]:
    docs = "\n\n".join(
        f"--- DOCUMENT: {d.label}{f' (v{d.version})' if d.version else ''} ---\n{d.text.strip()}\n--- END ---"
        for d in req.documents
        if d.text.strip()
    )
    prompt = (
        f"QUESTION THE USER WAS ASKED:\n{req.question.strip() or '(none)'}\n\n"
        f"THE USER'S ANSWER:\n{req.answer.strip()}\n\n"
        f"THE PROJECT'S SAVED DOCUMENTS:\n{docs or '(none)'}"
    )
    return _INSTRUCTION, prompt


def parse(raw: dict, req: CheckAnswerRequest) -> CheckAnswerResponse:
    """Kept only when the quote is verbatim in the document it names."""
    if not isinstance(raw, dict) or not raw.get("contradicts"):
        return CheckAnswerResponse(contradicts=False)
    label = str(raw.get("document", "")).strip()
    quote = str(raw.get("quote", "")).strip().strip('"')
    doc = next((d for d in req.documents if d.label.strip().lower() == label.lower()), None)
    if not doc or len(quote) < 8 or _norm(quote) not in _norm(doc.text):
        return CheckAnswerResponse(contradicts=False)
    return CheckAnswerResponse(
        contradicts=True,
        document=doc.label,
        version=doc.version,
        quote=quote[:600],
        claim=str(raw.get("claim", "")).strip()[:600],
        explanation=str(raw.get("explanation", "")).strip()[:800],
    )


async def check_answer(client: OpenRouterClient, req: CheckAnswerRequest) -> CheckAnswerResponse:
    if not req.answer.strip() or not any(d.text.strip() for d in req.documents):
        return CheckAnswerResponse(contradicts=False)
    system, prompt = build_prompt(req)
    try:
        raw, _usage = await client.generate_json(prompt=prompt, system=system, temperature=0, max_tokens=600, model=req.model or None)
    except Exception:  # noqa: BLE001 — a failed check never blocks the answer
        return CheckAnswerResponse(contradicts=False)
    return parse(raw, req)
