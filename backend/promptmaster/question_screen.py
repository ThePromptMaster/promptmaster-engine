"""Does a question Go wants to ask really need the user? (8 Nov)

Whether to ask had been left to the planner. On one delegated project it asked
whether someone had been confirmed for an hour of an event, then whether to
shorten a package it had estimated was too long, then marked the finished
document stuck on the event's staffing. On a book it asked three times whether to
apply corrections it had been told to apply. A second reader, given only the
question and the user's own words, says which kind of question it is.

One small model call, for a project whose routine decisions are handed to Go.
Anything but a clear "not for the user" is asked: a failed screen costs a
question, never a decision taken from the user.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .schemas import PMInput

#: Classifying one question does not need the default model.
SCREEN_MODEL = "anthropic/claude-sonnet-5.5"

Verdict = Literal["routine_repair", "routine_choice", "real_world_action", "business_decision", "reserved_approval", "missing_input"]
_VERDICTS = ("routine_repair", "routine_choice", "real_world_action", "business_decision", "reserved_approval", "missing_input")

SCREEN_INSTRUCTION = (
    "An AI assistant is carrying out a project for a user and wants to stop and ask them something. "
    "The user has handed routine decisions to the assistant. Say which kind of question this is.\n\n"
    "routine_repair: work the assistant can simply do. Shortening or lengthening to a target the user "
    "gave. Correcting something the supplied facts, sources or accepted findings settle. Making documents "
    "agree with the plan they depend on. Going back to an earlier stage to apply a correction. Re-running "
    "a check. Whether to do this is not a business decision.\n\n"
    # 8 Nov (a client): "Could it work like having 'Do whatever is best' selected automatically for
    # routine decisions". On his book he gave that answer six times to questions of this kind.
    "routine_choice: a choice between ways of doing the work that each fit what the user asked for, "
    "or permission to go ahead with work the user already asked for: an order, a layout, a wording, "
    "which of two acceptable treatments, whether to apply a correction now or later. Whichever is "
    "picked, the user is committed to nothing they have not already said. The assistant picks. "
    # 12 Nov (a client): "Could Go just record 'approver not specified' and keep moving when the plan
    # is already stated as approved?"
    "Who approved, authorised or signed off something the user's own words already call approved is one "
    "of these: the user is not asked, and the document records \"approver not specified\".\n\n"
    "real_world_action: it asks whether someone has done, or asks the user to get someone to do, something "
    "outside the document: confirming, booking, hiring, covering a shift, obtaining a signature, sending a "
    "message. The assistant only prepares documents, so the document records it as still to do.\n\n"
    "reserved_approval: it asks the user to approve or sign off something listed under RESERVED APPROVALS.\n\n"
    "missing_input: the document cannot be written without a fact only the user has, and the brief does not "
    "allow it to be left as a stated gap.\n\n"
    "business_decision: a choice that changes what the work commits to and that nothing supplied settles: "
    "budget, scope, deadline, which option to recommend, or a conflict between two requirements.\n\n"
    "A condition counts as a requirement only if the user's own words state it. A practice the assistant "
    "suggested itself (for example getting something \"in writing\") is not one. When a question rests on a "
    "real requirement, copy the user's words exactly into requirement_quote.\n"
    "If you are unsure between routine_repair or routine_choice and business_decision, choose "
    "business_decision.\n\n"
    "Return JSON only: {\"verdict\": one of the six names, \"reason\": one short sentence, "
    "\"instruction\": for routine_repair, the work to do, in one or two sentences, stating any target "
    "the question names; for routine_choice, empty, "
    "\"target_stage\": for routine_repair, the name of the EARLIER STAGE where the correction belongs, "
    "exactly as listed, or empty if it belongs on this stage, "
    "\"action\": for real_world_action, what still has to be done, in one short sentence, "
    "\"requirement_quote\": the user's exact words, or empty}."
)


class ScreenQuestionRequest(BaseModel):
    inputs: PMInput
    question: str = Field(..., min_length=1, max_length=6_000)
    stage_label: str = Field(default="", max_length=300)
    earlier_stages: list[str] = Field(default_factory=list, max_length=60)
    reserved_approvals: list[str] = Field(default_factory=list, max_length=40)
    delegation: list[str] = Field(default_factory=list, max_length=12)
    model: str = Field(default="", max_length=200)


class ScreenQuestionResponse(BaseModel):
    verdict: Verdict = "business_decision"
    reason: str = ""
    instruction: str = ""
    target_stage: str = ""
    action: str = ""
    requirement_quote: str = ""


def _user_words(inputs: PMInput) -> str:
    """Only what the user supplied: never a draft, never a model's assumption."""
    facts = [f.statement for f in inputs.facts if f.origin != "model_assumed"]
    return "\n".join(
        part for part in (inputs.objective, inputs.audience, inputs.constraints, inputs.output_format, inputs.context, *facts) if part
    )


def build_screen_prompt(req: ScreenQuestionRequest) -> tuple[str, str]:
    earlier = "\n".join(f"- {s}" for s in req.earlier_stages) or "(none)"
    reserved = "\n".join(f"- {s}" for s in req.reserved_approvals) or "(none)"
    delegation = "\n".join(f"- {s}" for s in req.delegation) or "(none stated)"
    user = (
        f"THE USER'S OWN WORDS:\n{_user_words(req.inputs)}\n\n"
        f"WHAT THE USER HANDED OVER, IN THEIR WORDS:\n{delegation}\n\n"
        f"THE STAGE THE ASSISTANT IS ON: {req.stage_label or '(unnamed)'}\n"
        f"EARLIER STAGES:\n{earlier}\n\n"
        f"RESERVED APPROVALS:\n{reserved}\n\n"
        f"THE QUESTION THE ASSISTANT WANTS TO ASK:\n{req.question}"
    )
    return SCREEN_INSTRUCTION, user


def parse_screen(result: dict, req: ScreenQuestionRequest) -> ScreenQuestionResponse:
    """Whatever cannot be carried out as stated falls back to asking."""
    verdict = result.get("verdict")
    if verdict not in _VERDICTS:
        return ScreenQuestionResponse(reason="The screen gave no usable verdict.")
    reason = str(result.get("reason") or "").strip()[:400]
    instruction = str(result.get("instruction") or "").strip()[:1_500]
    action = str(result.get("action") or "").strip()[:500]
    target = str(result.get("target_stage") or "").strip()
    target = next((s for s in req.earlier_stages if s.lower() == target.lower()), "")
    quote = str(result.get("requirement_quote") or "").strip()
    # A quote the user's words do not hold is not a requirement of theirs.
    if quote and quote.lower() not in _user_words(req.inputs).lower():
        quote = ""
    if verdict == "routine_repair" and not instruction:
        return ScreenQuestionResponse(reason=reason or "The screen named no work to do.")
    if verdict == "real_world_action" and not action:
        action = req.question.strip()[:500]
    return ScreenQuestionResponse(
        verdict=verdict, reason=reason, instruction=instruction if verdict == "routine_repair" else "",
        target_stage=target if verdict == "routine_repair" else "", action=action if verdict == "real_world_action" else "",
        requirement_quote=quote,
    )


async def screen_question(client: OpenRouterClient, req: ScreenQuestionRequest) -> ScreenQuestionResponse:
    system, user = build_screen_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=500, model=SCREEN_MODEL)
    return parse_screen(result, req)
