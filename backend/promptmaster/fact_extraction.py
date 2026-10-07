"""Facts read out of what the user attached (7 Oct, L-51).

The facts record (`project_facts`) held only what the user typed or confirmed.
A brief attached as a PDF reached prompts as project context — read by every
stage, but not as accepted facts with a source each. Go now proposes the
facts a document states, and under "Routine decisions: handle them for me"
records them, citing the file.

Each fact must quote its source word for word, and every figure in the fact
must be in that quote; anything else is dropped in code. Extraction is routine
(the text says it); judgment is not, so nothing inferred, computed or
recommended is a fact.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .project_context import facts_block
from .schemas import PMInput

MAX_FACTS = 12
MAX_SOURCE_CHARS = 30_000

_INSTRUCTION = (
    "You read the documents a user attached to a PromptMaster project and list the FACTS they "
    "state that bear on the objective: figures, dates, durations, names, conditions, constraints. "
    "Only what a document states — never an inference, a calculation, an opinion or a "
    "recommendation. Copy each fact's supporting passage exactly into \"quote\". Skip any fact "
    "already in the accepted facts. Return JSON only."
)


class SourceDoc(BaseModel):
    id: str = Field(max_length=200)
    label: str = Field(max_length=300)
    text: str = Field(max_length=200_000)


class ExtractedFact(BaseModel):
    statement: str = Field(max_length=2_000)
    subject: str = Field(default="", max_length=200)
    kind: str = Field(default="fact", pattern="^(fact|requirement)$")
    source_id: str = Field(max_length=200)
    quote: str = Field(max_length=1_000)


def build_extraction_prompt(inputs: PMInput, sources: list[SourceDoc]) -> tuple[str, str]:
    docs = "\n\n".join(f"--- SOURCE id={s.id}: {s.label} ---\n{s.text[:MAX_SOURCE_CHARS]}\n--- END ---" for s in sources)
    facts = facts_block(inputs)
    user = (
        f"OBJECTIVE: {inputs.objective}\n"
        + (f"{facts}\n" if facts else "ACCEPTED FACTS: none yet.\n")
        + f"\n{docs}\n\n"
        f"List at most {MAX_FACTS} facts. Return JSON: "
        '{"facts": [{"statement": "one fact, in plain words", "subject": "what it is about, or \\"\\"", '
        '"kind": "fact|requirement", "source_id": "...", "quote": "the passage, copied exactly"}]}'
    )
    return _INSTRUCTION, user


def _norm(text: str) -> str:
    return " ".join(text.replace(",", "").split()).lower()


_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def parse_extraction(result: object, sources: list[SourceDoc], existing: list[str]) -> list[ExtractedFact]:
    if not isinstance(result, dict):
        return []
    by_id = {s.id: _norm(s.text) for s in sources}
    seen = {_norm(e) for e in existing}
    out: list[ExtractedFact] = []
    for raw in (result.get("facts") or [])[:MAX_FACTS * 2]:
        if not isinstance(raw, dict):
            continue
        statement = " ".join(str(raw.get("statement") or "").split())[:2_000]
        quote = " ".join(str(raw.get("quote") or "").split())[:1_000]
        sid = str(raw.get("source_id") or "")
        if not statement or not quote or sid not in by_id:
            continue
        # The quote is in the source, word for word…
        if _norm(quote) not in by_id[sid]:
            continue
        # …and every figure in the fact is in the quote.
        if not all(n.replace(",", "") in quote.replace(",", "") for n in _NUMBER.findall(statement)):
            continue
        if _norm(statement) in seen:
            continue
        seen.add(_norm(statement))
        out.append(ExtractedFact(
            statement=statement,
            subject=" ".join(str(raw.get("subject") or "").split())[:200],
            kind="requirement" if raw.get("kind") == "requirement" else "fact",
            source_id=sid,
            quote=quote,
        ))
        if len(out) >= MAX_FACTS:
            break
    return out


async def extract_facts(client: OpenRouterClient, model: str | None, inputs: PMInput, sources: list[SourceDoc]) -> list[ExtractedFact]:
    if not sources:
        return []
    system, user = build_extraction_prompt(inputs, sources)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=2_000, model=model)
    return parse_extraction(result, sources, [f.statement for f in inputs.facts])
