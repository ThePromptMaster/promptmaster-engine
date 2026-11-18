"""Whether a version proposes any new commitment (18 Nov, Sean, Executive Search).

A designed workflow can give a stage that extracts what the user supplied a second
sign-off for "the new commitments it proposes" (a deadline, a budget, a promise, a
scope change not in the source). Sean's role brief said in so many words that it
proposed none, and Go still stopped for "I accept any new commitments this brief
proposes": a sign-off with nothing to sign.

One small call reads the version and says whether it proposes anything of the kind.
"None" is kept only with a passage copied from the version that shows it (the
brief's own "No new commitments are proposed", or the section that lists none),
and is recorded against that version alone. Anything else, a failure included,
leaves the sign-off to the user: a commitment is never waved through on a guess.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .deliverable_check import _found
from .llm_client import OpenRouterClient

#: Reading one short stage for one question does not need the default model.
COMMITMENTS_MODEL = "anthropic/claude-haiku-5.5"

#: A stage that sets up a project is short; a long one is read whole up to this.
MAX_STAGE_CHARS = 40_000

COMMITMENTS_INSTRUCTION = (
    "A project stage has THE SIGN-OFF, by which the user accepts what the stage adds of the kind the sign-off "
    "names: new commitments, assumptions, topics, interpretations, or whatever its words say. Read the STAGE "
    "TEXT and say whether it adds or proposes anything of that kind that the SUPPLIED MATERIAL does not "
    "already contain.\n\n"
    "For commitments: something that would bind someone, such as a deadline or date, a budget, fee or cost, a "
    "promise or undertaking, a number of candidates or deliverables, a change of scope. For assumptions, "
    "topics or interpretations: any the text adds beyond what was supplied. Restating what was supplied is "
    "not an addition, nor is a placeholder (\"not supplied\", \"to confirm\") or a question. Anything the text "
    "puts forward for the user to accept or turn down counts as proposed, however it is labelled: items marked "
    "proposed, open, optional, pending or \"not committed\", options, and recommendations.\n\n"
    "Return JSON only: {\"proposes\": true or false, \"quote\": \"...\"}.\n"
    "- proposes true: quote the passage, copied exactly, that adds or proposes one.\n"
    "- proposes false: quote a passage, copied exactly, that shows none is added: where the text says so, "
    "or the section where they would be stated. 8 to 300 characters.\n"
    "When you cannot tell, answer proposes true with an empty quote."
)


class CommitmentsRequest(BaseModel):
    #: The sign-off as the checklist shows it.
    criterion: str = Field(..., min_length=1, max_length=400)
    stage_label: str = Field(default="", max_length=300)
    #: The version's text.
    content: str = Field(default="", max_length=400_000)
    #: What the user supplied: the objective, constraints and material, as one text.
    supplied: str = Field(default="", max_length=200_000)


class CommitmentsResponse(BaseModel):
    #: False only when the version shows it proposes none, with `quote` from it.
    proposes: bool = True
    quote: str = ""


def build_commitments_prompt(req: CommitmentsRequest) -> tuple[str, str]:
    user = (
        f"THE SIGN-OFF: {req.criterion}\n"
        f"THE STAGE: {req.stage_label or '(unnamed)'}\n\n"
        f"SUPPLIED MATERIAL:\n<<<\n{req.supplied.strip()[:MAX_STAGE_CHARS] or '(none)'}\n>>>\n\n"
        f"STAGE TEXT:\n<<<\n{req.content.strip()[:MAX_STAGE_CHARS]}\n>>>"
    )
    return COMMITMENTS_INSTRUCTION, user


#: Words that say there is none: what a passage showing "nothing proposed" has to contain.
_NONE = re.compile(r"\b(?:no|none|nothing|neither|without|not\s+any)\b", re.I)
#: A line that puts something forward for the user: proposed items, open lines, options, approvals asked.
_PUTS_FORWARD = re.compile(
    r"\bpropos(?:e|es|ed|al|als)\b|\boptional\b|\bopen\s+(?:lines?|items?|points?)\b|\bfor\s+(?:your|the\s+user'?s)\s+approval\b"
    r"|\bneeds?\s+(?:your|the\s+user'?s)\s+approval\b|\bapproval\s+required\b",
    re.I,
)


def puts_forward(content: str) -> bool:
    """A line of the version proposes something and does not say there is none (18 Nov
    production pass: "Open lines (proposed, not committed)" — seats and refreshments
    against the cap — was taken for "nothing proposed")."""
    return any(_PUTS_FORWARD.search(line) and not _NONE.search(line) for line in content.splitlines())


def parse_commitments(result: object, content: str) -> CommitmentsResponse:
    """"None proposed" stands only with a passage of the version that says there is
    none, and only when no line of the version puts something forward."""
    if not isinstance(result, dict) or result.get("proposes") is not False:
        return CommitmentsResponse()
    quote = " ".join(str(result.get("quote") or "").split()).strip("\"“”")[:300]
    if not _found(quote, content) or not _NONE.search(quote) or puts_forward(content):
        return CommitmentsResponse()
    return CommitmentsResponse(proposes=False, quote=quote)


async def check_commitments(client: OpenRouterClient, req: CommitmentsRequest) -> CommitmentsResponse:
    if not req.content.strip():
        return CommitmentsResponse()
    system, user = build_commitments_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=400, model=COMMITMENTS_MODEL)
    return parse_commitments(result, req.content)
