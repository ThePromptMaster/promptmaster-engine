"""The options a decision puts to the user, read from the stage itself (12 Nov).

A reserved approval was one button, "Approve and resume". On one project the
stage laid out raising a salary cap or keeping it and said "Awaiting the user's
decision"; on another the approval read "I choose Option A or Option B (stating
which one)". Neither gave anywhere to say which. The tick recorded nothing about
the choice, the stage went on saying the decision was awaited, and Go asked the
same question again on the next stage.

One small model call reads the stage's text and returns the options it puts to
the user for that approval, each with the passage that states it. An option is
kept only when its passage is found in the text, and fewer than two that can be
traced is no choice at all. Any failure returns none: the card then shows the
plain approval and a box for the decision, so nothing is ever invented for the
user to press.

Whose choice it is (12 Nov, production pass). A proposal written for a client
offered that client "Option A" and "Option B"; its sign-off, "I approve this
proposal to send to the client", was shown those two as buttons, as if the
user were picking the client's package. Options a document offers its own
reader are the work, not the user's decision. So the call also says how the
approval is worded, and one that only signs the work off is never given
options: an English sign-off with no word of choosing in it is not even sent.
(Letting a sign-off keep options when the text "left the decision open" was
tried against the saved texts: it gave a brief's sign-off the later stage's
decision in two runs of three.)
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .deliverable_check import _found, _norm
from .llm_client import OpenRouterClient
from .project_context import context_block
from .schemas import PMInput

#: Reading a few options out of one stage does not need the default model.
OPTIONS_MODEL = "anthropic/claude-sonnet-5.5"

MAX_OPTIONS = 4
#: The most of a stage's text the call is shown. A decision stage is short; a
#: long one is read from its end, where the choice is usually put.
MAX_STAGE_CHARS = 24_000

OPTIONS_INSTRUCTION = (
    "A project stage is waiting for its user to give an approval, and the page can offer them buttons. "
    "Read the STAGE TEXT and list the options it puts to the user for THE APPROVAL, so each can be a button.\n\n"
    "An option is a course of action the text lays out for the user to choose between: for example "
    "\"Option A: approve the $2,400 carrier cost\" and \"Option B: move the two deadlines, no extra spend\". "
    "When the text frames the decision as approving a change or keeping things as they are, those are the two "
    "options. Include declining, deferring or \"neither\" only when the text itself offers it.\n\n"
    "For each option give:\n"
    "- label: the option as the user would say it, at most 18 words, using the text's own name for it "
    "(Option A, Option B) when it has one, with the figure or the name that tells it apart from the others.\n"
    "- quote: a passage copied exactly from the STAGE TEXT that states this option, 8 to 300 characters.\n\n"
    "Return no options when the text does not put a choice between alternatives to the user: an approval that "
    "only accepts or signs off the text as it stands (\"I approve this brief\", \"I accept this as final\") "
    "has none. Never write an option the text does not state, and never recommend one.\n\n"
    "WHOSE CHOICE IT IS. The user is the person who owns this project and gives THE APPROVAL. A document often "
    "offers options to someone else: a proposal offers its client two packages, a memo puts alternatives to a "
    "board, a letter gives its reader ways to reply. Those are the document's content and its reader's choice. "
    "They are not the user's decision, whoever THE AUDIENCE is: return no options for them. Options count only "
    "when the choice is the user's own and still open.\n\n"
    "Also say how THE APPROVAL itself is worded, as approval_asks: \"choice\" when its own words have the "
    "user choose or decide something (\"I choose Option A or Option B\", \"I approve this decision on the "
    "cap\"); \"sign_off\" when it approves, accepts or releases the work as it stands (\"I approve this "
    "proposal to send to the client\", \"I accept this analysis\", \"I approve this brief as accurate\"). "
    "A sign-off has no options, whatever the text lays out.\n\n"
    "Return JSON only: {\"approval_asks\": \"choice\" or \"sign_off\", "
    "\"question\": the decision the user is asked to make, in one short sentence, or empty, "
    f"\"options\": [{{\"label\": \"...\", \"quote\": \"...\"}}]}} with at most {MAX_OPTIONS} options."
)


class DecisionOptionsRequest(BaseModel):
    inputs: PMInput
    #: The approval's own wording, as the checklist shows it.
    approval: str = Field(..., min_length=1, max_length=400)
    stage_label: str = Field(default="", max_length=300)
    #: The stage's current text.
    content: str = Field(default="", max_length=400_000)
    model: str = Field(default="", max_length=200)


class DecisionOption(BaseModel):
    label: str
    #: The passage of the stage's text that states it.
    quote: str


class DecisionOptionsResponse(BaseModel):
    #: The decision in one sentence; "" when the call gave none.
    question: str = ""
    options: list[DecisionOption] = Field(default_factory=list)


def _shown(content: str) -> str:
    text = content.strip()
    return text if len(text) <= MAX_STAGE_CHARS else text[-MAX_STAGE_CHARS:]


def build_options_prompt(req: DecisionOptionsRequest) -> tuple[str, str]:
    context = context_block(req.inputs)
    user = (
        f"OBJECTIVE: {req.inputs.objective}\n"
        + (f"THE AUDIENCE (who the work is written for): {req.inputs.audience}\n" if req.inputs.audience else "")
        + (f"CONSTRAINTS: {req.inputs.constraints}\n" if req.inputs.constraints else "")
        + (f"\n{context}\n" if context else "")
        + f"\nTHE STAGE: {req.stage_label or '(unnamed)'}\n"
        f"THE APPROVAL: {req.approval}\n\n"
        f"STAGE TEXT:\n<<<\n{_shown(req.content)}\n>>>"
    )
    return OPTIONS_INSTRUCTION, user


def parse_options(result: object, content: str) -> DecisionOptionsResponse:
    """An option stays only with its passage found in the stage's text; one
    option, or none, is not a choice. An approval that only signs the work off
    has none: a reply that does not say the approval asks for a choice is read
    as a sign-off."""
    if not isinstance(result, dict):
        return DecisionOptionsResponse()
    if str(result.get("approval_asks") or "").strip().lower() != "choice":
        return DecisionOptionsResponse()
    kept: list[DecisionOption] = []
    seen: set[str] = set()
    for item in result.get("options") or []:
        if not isinstance(item, dict):
            continue
        label = " ".join(str(item.get("label") or "").split()).strip("\"“” ")[:160]
        quote = " ".join(str(item.get("quote") or "").split()).strip("\"“”")[:300]
        key = _norm(label)
        if not label or not key or key in seen or not _found(quote, content):
            continue
        seen.add(key)
        kept.append(DecisionOption(label=label, quote=quote))
        if len(kept) >= MAX_OPTIONS:
            break
    if len(kept) < 2:
        return DecisionOptionsResponse()
    question = " ".join(str(result.get("question") or "").split())[:300]
    return DecisionOptionsResponse(question=question, options=kept)


_SIGNS_OFF = re.compile(r"^\W*I\s+(?:approve|accept|agree|confirm|have\s+(?:read|reviewed|checked))\b", re.I)
_CHOOSING = re.compile(r"\b(?:choose|chosen|choice|select|decide|decision|which|options?)\b", re.I)


def plainly_signs_off(approval: str) -> bool:
    """An English sign-off with no word of choosing in it: "I approve this
    proposal to send to the client". Decided here, so it costs no call and no
    model can read a choice into it. Any other wording, in any language, is
    read by the call."""
    return bool(_SIGNS_OFF.search(approval)) and not _CHOOSING.search(approval)


async def decision_options(client: OpenRouterClient, req: DecisionOptionsRequest) -> DecisionOptionsResponse:
    if not req.content.strip() or plainly_signs_off(req.approval):
        return DecisionOptionsResponse()
    system, user = build_options_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=700, model=OPTIONS_MODEL)
    return parse_options(result, req.content)
