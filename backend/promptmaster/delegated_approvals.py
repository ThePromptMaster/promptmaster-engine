"""Which approvals the user's brief hands to Go (19 Nov, Sean, Equipment Replacement).

His brief said "Handle routine drafting, arithmetic, checking, and revisions
autonomously. Keep warranty verification and actual purchase authorization
pending." The designed workflow still made "I choose the vendor to recommend"
an approval only he could give, and Go stopped for it as "yours alone", with
both vendors at $69,000 and enough to recommend one.

One small call reads the brief and, for each approval the workflow reserves to
the user, says whether the user's own words hand it over: in so many words
("make the recommendation yourself"), or by saying what they keep back when
this is not among it. A yes stands only with a passage copied from the user's
own words; anything else, a failure included, leaves the approval to the user.
The page records a yes as an event, and the user can take it back.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient
from .schemas import PMInput

#: Reading a brief for a few approvals does not need the default model.
DELEGATED_MODEL = "anthropic/claude-haiku-5.5"

#: The brief as typed is enough; a long project context is cut for the call.
MAX_BRIEF_CHARS = 30_000

#: Never handed over, whatever the brief says: authorising a spend, a purchase, a
#: payment, a signature, or something going out. The user's to give.
_AUTHORISES = re.compile(
    r"\b(?:authori[sz]\w*|purchas\w*|spend\w*|pay\w*|sign\w*|send\w*|sent|releas\w*|publish\w*|contract\w*|hire|hiring|order\w*)\b",
    re.I,
)

DELEGATED_INSTRUCTION = (
    "A user set up a project and an assistant carries it out. The project's workflow reserves some "
    "approvals to the user. For each RESERVED APPROVAL, say whether THE USER'S OWN WORDS hand it to the "
    "assistant.\n\n"
    "It is handed over when the user's words give it to the assistant (\"make the recommendation "
    "yourself\", \"you choose\", \"decide which option\"), or when they say what they keep for themselves "
    "(\"keep X and Y pending\", \"I will authorise Z\", \"leave the final sign-off to me\") and this approval "
    "is not among what they keep. It is not handed over when their words keep it, when they ask to make "
    "or approve it themselves, or when nothing they say covers it either way.\n\n"
    "Return JSON only: {\"approvals\": [{\"id\": the approval's id, \"hands_over\": true or false, "
    "\"quote\": the sentence of THE USER'S OWN WORDS that decides it, copied exactly}]}.\n"
    "When you cannot tell, hands_over is false."
)


class ReservedApproval(BaseModel):
    id: str = Field(..., min_length=1, max_length=200)
    label: str = Field(..., min_length=1, max_length=400)
    stage_label: str = Field(default="", max_length=300)


class ApprovalDelegatedRequest(BaseModel):
    inputs: PMInput
    approvals: list[ReservedApproval] = Field(default_factory=list, max_length=20)
    #: The brief's sentences that grant, reserve or limit authority (`delegation.ts`).
    delegation: list[str] = Field(default_factory=list, max_length=12)


class ApprovalHandedOver(BaseModel):
    id: str
    quote: str


class ApprovalDelegatedResponse(BaseModel):
    #: Only the approvals the user's words hand over, each with the words that do.
    approvals: list[ApprovalHandedOver] = Field(default_factory=list)


def user_words(inputs: PMInput) -> str:
    """Only what the user supplied: never a draft, never a model's assumption."""
    facts = [f.statement for f in inputs.facts if f.origin not in ("model_assumed", "policy")]
    return "\n".join(part for part in (inputs.objective, inputs.constraints, inputs.context, *facts) if part)


def build_delegated_prompt(req: ApprovalDelegatedRequest) -> tuple[str, str]:
    approvals = "\n".join(f"- id {a.id} ({a.stage_label or 'a stage'}): {a.label}" for a in req.approvals)
    delegation = "\n".join(f"- {d}" for d in req.delegation) or "(none found)"
    user = (
        f"THE USER'S OWN WORDS:\n<<<\n{user_words(req.inputs)[:MAX_BRIEF_CHARS]}\n>>>\n\n"
        f"SENTENCES OF THEIRS ABOUT WHAT THE ASSISTANT MAY DO:\n{delegation}\n\n"
        f"RESERVED APPROVALS:\n{approvals}"
    )
    return DELEGATED_INSTRUCTION, user


def parse_delegated(result: object, req: ApprovalDelegatedRequest) -> ApprovalDelegatedResponse:
    """A hand-over stands only for an approval that was sent, that authorises nothing,
    with the user's own sentence found in their words."""
    if not isinstance(result, dict) or not isinstance(result.get("approvals"), list):
        return ApprovalDelegatedResponse()
    sent = {a.id: a for a in req.approvals}
    words = user_words(req.inputs)
    out: list[ApprovalHandedOver] = []
    for item in result["approvals"]:
        if not isinstance(item, dict) or item.get("hands_over") is not True:
            continue
        approval = sent.get(str(item.get("id") or ""))
        quote = " ".join(str(item.get("quote") or "").split()).strip("\"“”")[:400]
        if approval is None or _AUTHORISES.search(approval.label) or not _found(quote, words):
            continue
        if any(o.id == approval.id for o in out):
            continue
        out.append(ApprovalHandedOver(id=approval.id, quote=quote))
    return ApprovalDelegatedResponse(approvals=out)


async def approvals_delegated(client: OpenRouterClient, req: ApprovalDelegatedRequest) -> ApprovalDelegatedResponse:
    eligible = [a for a in req.approvals if not _AUTHORISES.search(a.label)]
    if not eligible or not user_words(req.inputs).strip():
        return ApprovalDelegatedResponse()
    system, user = build_delegated_prompt(req.model_copy(update={"approvals": eligible}))
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=600, model=DELEGATED_MODEL)
    return parse_delegated(result, req)
