"""What a text says about an amount or item, checked against what was supplied (4 Nov).

Sean, support-software memo: the arithmetic was right, but the memo said all
$3,380 of option B's upfront payment was nonrefundable. The supplied facts
said only "The annual subscription payment is nonrefundable" — the $2,880 —
and gave no terms for the $500 setup fee. The stage check and a manual
recheck both passed it: they checked the figures, and the figures were right.
Code accepts $3,380 as a sum of supplied figures (`figure-support.ts`), and
the claim checks covered only invented personal details (`claim_check.py`)
and conclusions a changed fact undid (`dependent_claims.py`).

Whether a term is attached to the right thing is a reading, so one small call
does it, and its answer is held in code: a claim is kept only when its quote is
verbatim in the text, and the supplied passage it names — when it names one —
is verbatim in what was supplied. A failed check reports nothing; it never
stands between the user and the work.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

MAX_CLAIMS = 6


class ClaimSupportRequest(BaseModel):
    stage_label: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=200_000)
    #: What the user supplied: their request and the accepted facts.
    supplied: str = Field(min_length=1, max_length=60_000)
    model: str = ""


class UnsupportedClaim(BaseModel):
    #: The span of the text that makes the claim, verbatim.
    quote: str
    #: The supplied passage it misstates, verbatim; empty when nothing supplied covers it.
    supplied: str = ""
    why: str = ""


class ClaimSupportResponse(BaseModel):
    claims: list[UnsupportedClaim] = Field(default_factory=list)


_INSTRUCTION = (
    "You check a document against the material the user SUPPLIED. Report each statement in the TEXT that "
    "attaches a term, condition or status to an amount, option, item or party that the supplied material "
    "does not attach to it. Terms such as: nonrefundable or refundable; one-time or recurring; monthly, "
    "annual or upfront; included or extra; committed, cancellable or with no commitment; approved, "
    "authorised or signed off; measured, verified, tested or confirmed; guaranteed; required or optional; "
    "compatible; available.\n"
    "Look especially for:\n"
    "- a term stated of a whole when the supplied material gives it for only a part (\"the $3,380 upfront "
    "payment is nonrefundable\" when only the annual subscription payment, $2,880 of it, is said to be "
    "nonrefundable and the $500 setup fee's terms are not given);\n"
    "- a term the supplied material gives for one item moved to another;\n"
    "- a term the supplied material leaves unknown, stated as known (\"cancellable at any time\" when only "
    "\"monthly billing\" was supplied);\n"
    "- a status stated as settled that the supplied material says is unconfirmed or not authorised.\n"
    "Do NOT report: a figure or calculation (only the term attached to it); a term the supplied material "
    "gives for exactly that item; a statement marked as an assumption, an estimate, unknown or to be "
    "confirmed; a recommendation or next step; or wording that says the same thing in other words. When in "
    "doubt, report nothing.\n"
    "For each, quote the shortest span of the TEXT that makes the claim, copied verbatim (one sentence or "
    "less); quote the SUPPLIED passage it misstates, copied verbatim, or \"\" when nothing supplied covers it; "
    "and say in a few words what the supplied material does and does not say.\n"
    'Return JSON: {"claims": [{"quote": string, "supplied": string, "why": string}]}'
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`#>|“”\"’'«»„‚‹›]", "", text.replace("\\", ""))).strip().lower()


def build_prompt(req: ClaimSupportRequest) -> tuple[str, str]:
    prompt = (
        f"WHAT THE USER SUPPLIED:\n{req.supplied.strip()}\n\n"
        f"THE TEXT ({req.stage_label.strip() or 'the document'}):\n{req.text.strip()}"
    )
    return _INSTRUCTION, prompt


def _clean(value: object, n: int) -> str:
    return " ".join(str(value or "").split()).strip("\"“”'«»„‚‹› ")[:n]


def parse(raw: object, req: ClaimSupportRequest) -> ClaimSupportResponse:
    """A claim is kept only with its quote verbatim in the text, and a supplied
    passage, when one is named, verbatim in what was supplied."""
    if not isinstance(raw, dict) or not isinstance(raw.get("claims"), list):
        return ClaimSupportResponse()
    text, supplied = _norm(req.text), _norm(req.supplied)
    out: list[UnsupportedClaim] = []
    for item in raw["claims"][: MAX_CLAIMS * 2]:
        if not isinstance(item, dict):
            continue
        quote = _clean(item.get("quote"), 400)
        q = _norm(quote)
        if len(q) < 8 or q not in text:
            continue
        # A claim the supplied material states word for word is supported.
        if q in supplied:
            continue
        source = _clean(item.get("supplied"), 400)
        s = _norm(source)
        if s and (len(s) < 8 or s not in supplied):
            continue
        if any(_norm(c.quote) == q for c in out):
            continue
        out.append(UnsupportedClaim(quote=quote, supplied=source, why=" ".join(str(item.get("why") or "").split())[:240]))
        if len(out) >= MAX_CLAIMS:
            break
    return ClaimSupportResponse(claims=out)


async def claim_support(client: OpenRouterClient, req: ClaimSupportRequest) -> ClaimSupportResponse:
    if not req.text.strip() or not req.supplied.strip():
        return ClaimSupportResponse()
    system, prompt = build_prompt(req)
    try:
        raw, _usage = await client.generate_json(prompt=prompt, system=system, temperature=0, max_tokens=1_200, model=req.model or None)
    except Exception:  # noqa: BLE001 — a failed check never blocks the work
        return ClaimSupportResponse()
    return parse(raw, req)
