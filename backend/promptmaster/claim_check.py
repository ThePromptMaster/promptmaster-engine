"""Personal details a revision added that the user never supplied (14 Oct).

Sean, wedding speech: told "do not invent memories or stories" and, in the
revision, "add no new personal details", the rewrite still said "a lifelong
pattern of Emma being the organized one and me just trying to keep up", and
turned "corrected him when he skipped a line" into "made me do it properly".
Claude did the same. "A rewrite can sound better while becoming less
accurate."

Restyling is not the problem; a new claim about a real person is. Telling one
from the other is a reading, so one small call does it, and its answer is
held in code: a claim is kept only when its quote is verbatim in the new text
and NOT in the text before, so nothing the user already had is reported. It
runs only when the project says not to invent details (frontend
`lib/workflow/fact-boundary.ts`). A failed check reports nothing; it never
stands between the user and the revision.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

MAX_CLAIMS = 6


class NewClaimsRequest(BaseModel):
    before: str = Field(default="", max_length=200_000)
    after: str = Field(min_length=1, max_length=200_000)
    #: Everything the user supplied: the brief, the answers to questions, the facts.
    supplied: str = Field(default="", max_length=60_000)
    instruction: str = Field(default="", max_length=8_000)
    model: str = ""


class NewClaim(BaseModel):
    quote: str
    why: str = ""


class NewClaimsResponse(BaseModel):
    claims: list[NewClaim] = Field(default_factory=list)


_INSTRUCTION = (
    "A user asked for a document about real people and said not to invent personal details. "
    "Compare the REVISED TEXT with what the user SUPPLIED and with the TEXT BEFORE. Report each "
    "statement in the revised text that presents something about a person as true that neither "
    "source states: a memory or event, a habit or lifelong pattern, a relationship history, a "
    "trait, or an embellishment of a supplied event (it says more happened than was supplied). "
    "Do NOT report: rewording, tone, jokes about the occasion itself, greetings, toasts, wishes "
    "for the future, opinions the speaker plainly offers as their own feeling, or anything the "
    "supplied text or the text before already says in other words. When in doubt, report nothing.\n"
    "For each, quote the shortest span of the revised text that carries the new claim, copied "
    "verbatim (one sentence or less), and say in a few words what was not supplied.\n"
    'Return JSON: {"claims": [{"quote": string, "why": string}]}'
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>“”\"’']", "", text.replace("\\", ""))).strip().lower()


def build_prompt(req: NewClaimsRequest) -> tuple[str, str]:
    prompt = (
        f"WHAT THE USER SUPPLIED:\n{req.supplied.strip() or '(nothing beyond the text before)'}\n\n"
        f"THE USER'S INSTRUCTION FOR THIS REVISION:\n{req.instruction.strip() or '(none)'}\n\n"
        f"THE TEXT BEFORE:\n{req.before.strip() or '(none)'}\n\n"
        f"THE REVISED TEXT:\n{req.after.strip()}"
    )
    return _INSTRUCTION, prompt


def parse(raw: object, req: NewClaimsRequest) -> NewClaimsResponse:
    """A claim is kept only with a quote verbatim in the revised text that the
    text before and the supplied material do not already contain."""
    if not isinstance(raw, dict) or not isinstance(raw.get("claims"), list):
        return NewClaimsResponse()
    after, before, supplied = _norm(req.after), _norm(req.before), _norm(req.supplied)
    out: list[NewClaim] = []
    for item in raw["claims"][:MAX_CLAIMS * 2]:
        if not isinstance(item, dict):
            continue
        quote = " ".join(str(item.get("quote") or "").split()).strip("\"“”'")[:400]
        q = _norm(quote)
        if len(q) < 8 or q not in after or q in before or q in supplied:
            continue
        if any(_norm(c.quote) == q for c in out):
            continue
        out.append(NewClaim(quote=quote, why=" ".join(str(item.get("why") or "").split())[:200]))
        if len(out) >= MAX_CLAIMS:
            break
    return NewClaimsResponse(claims=out)


async def check_new_claims(client: OpenRouterClient, req: NewClaimsRequest) -> NewClaimsResponse:
    if not req.after.strip():
        return NewClaimsResponse()
    system, prompt = build_prompt(req)
    try:
        raw, _usage = await client.generate_json(prompt=prompt, system=system, temperature=0, max_tokens=800, model=req.model or None)
    except Exception:  # noqa: BLE001 — a failed check never blocks the revision
        return NewClaimsResponse()
    return parse(raw, req)
