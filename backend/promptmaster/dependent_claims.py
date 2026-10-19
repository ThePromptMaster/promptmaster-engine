"""Conclusions that no longer follow from the facts as they now stand (18 Oct).

Sean, Summit operating review: the CFO corrected current-quarter revenue
downwards, every figure was updated, and the pack still said "EBITDA
deterioration despite higher revenue" through three repairs. The check after a
repair looks for the old *values* in code (`leftoverValues`), and a conclusion
drawn from an old value contains none of them: "higher revenue" is not "$24
million". Telling whether a sentence still follows is a reading, so one small
call does it — only when an accepted fact has replaced something — and its
answer is held in code: a sentence is kept only when its quote is verbatim in
the text, so the repair can be checked for it afterwards. A failed check
reports nothing; it never stands between the user and the work.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

MAX_CLAIMS = 8


class ChangedFact(BaseModel):
    statement: str = Field(max_length=2_000)
    #: The value or statement it replaced, where known.
    replaces: str = Field(default="", max_length=2_000)


class DependentClaimsRequest(BaseModel):
    stage_label: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=200_000)
    #: The accepted facts that replaced something — what the check reads the text against.
    changed: list[ChangedFact] = Field(default_factory=list, max_length=40)
    #: Every other accepted fact, for context.
    facts: list[str] = Field(default_factory=list, max_length=200)
    model: str = ""


class DependentClaim(BaseModel):
    quote: str
    fact: str = ""
    why: str = ""


class DependentClaimsResponse(BaseModel):
    claims: list[DependentClaim] = Field(default_factory=list)


_INSTRUCTION = (
    "Some accepted facts of a project were corrected or replaced. The TEXT may already state the new figures "
    "everywhere and still draw a conclusion that only followed from the old ones. Find each sentence in the TEXT "
    "whose conclusion, comparison, direction or explanation no longer follows from the facts as they now stand: "
    "a trend that reversed (\"despite higher revenue\" when revenue is now lower than before), a cause or "
    "attribution that rested on the replaced value, a ranking, threshold or status that changed (\"within "
    "budget\", \"the largest customer\", \"not approved\" when it now is), or a recommendation justified only by "
    "the old figure.\n"
    "Do NOT report: a sentence that states the new value correctly; one that records history on purpose (a change "
    "log, a correction note, \"previously reported as …\"); one whose conclusion still holds with the new facts; "
    "a figure that is merely unrelated to the change. When in doubt, report nothing.\n"
    "For each, quote the sentence from the TEXT verbatim (one sentence or less), name the current fact it "
    "contradicts, and say in a few words why it no longer follows.\n"
    'Return JSON: {"claims": [{"quote": string, "fact": string, "why": string}]}'
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>“”\"’'|]", "", text.replace("\\", ""))).strip().lower()


def build_prompt(req: DependentClaimsRequest) -> tuple[str, str]:
    changed = "\n".join(
        f"- {c.statement.strip()}" + (f" (replaces: {c.replaces.strip()})" if c.replaces.strip() else "")
        for c in req.changed
    )
    others = "\n".join(f"- {f.strip()}" for f in req.facts if f.strip())
    prompt = (
        f"FACTS THAT CHANGED (current — each replaces what it names):\n{changed}\n\n"
        f"OTHER ACCEPTED FACTS:\n{others or '(none)'}\n\n"
        f"THE TEXT ({req.stage_label.strip() or 'the stage'}):\n{req.text.strip()}"
    )
    return _INSTRUCTION, prompt


def parse(raw: object, req: DependentClaimsRequest) -> DependentClaimsResponse:
    """A claim is kept only with a quote verbatim in the text: the repair is
    then checked, in code, for whether that sentence is still there."""
    if not isinstance(raw, dict) or not isinstance(raw.get("claims"), list):
        return DependentClaimsResponse()
    text = _norm(req.text)
    out: list[DependentClaim] = []
    for item in raw["claims"][: MAX_CLAIMS * 2]:
        if not isinstance(item, dict):
            continue
        quote = " ".join(str(item.get("quote") or "").split()).strip("\"“”'")[:500]
        q = _norm(quote)
        if len(q) < 12 or q not in text or any(_norm(c.quote) == q for c in out):
            continue
        out.append(DependentClaim(
            quote=quote,
            fact=" ".join(str(item.get("fact") or "").split())[:300],
            why=" ".join(str(item.get("why") or "").split())[:240],
        ))
        if len(out) >= MAX_CLAIMS:
            break
    return DependentClaimsResponse(claims=out)


async def dependent_claims(client: OpenRouterClient, req: DependentClaimsRequest) -> DependentClaimsResponse:
    if not req.text.strip() or not req.changed:
        return DependentClaimsResponse()
    system, prompt = build_prompt(req)
    try:
        raw, _usage = await client.generate_json(prompt=prompt, system=system, temperature=0, max_tokens=1200, model=req.model or None)
    except Exception:  # noqa: BLE001 — a failed check never blocks the work
        return DependentClaimsResponse()
    return parse(raw, req)
