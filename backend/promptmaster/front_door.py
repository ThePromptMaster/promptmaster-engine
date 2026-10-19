"""Talking a project into shape before it exists (Sean, 6 Oct, email 8:
"PromptMaster could use a conversational front door … As the conversation
continues, it could build a visible structured project brief … Conversational
brainstorming should not silently become authoritative project state.").

One call per turn: a reply to the user, and the draft brief as it stands. The
brief is a draft — nothing is saved here — and its facts and requirements are
kept only when the user said them (figures in the user's own messages,
checked in code), so the confirmation screen shows nothing the model made up.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .self_model import PROMPTMASTER_SELF_MODEL
from .source_access import LINKS_RULE

MAX_TURNS = 40
MAX_LIST = 12

_SYSTEM = (
    "You help someone work out a project before PromptMaster creates it. Talk naturally; ask "
    "at most ONE useful question per reply, and only when the answer would change the project. "
    "Alongside your reply, keep a draft brief of what the user has actually said: objective, "
    "audience, requirements, evidence (facts and figures they gave), deliverables, and — once "
    "the work is clear — the stages an expert would go through and the points they must approve. "
    "Never put in the brief anything the user did not say or plainly agree to; leave a field "
    "empty instead. When the objective, the deliverable and the main requirements are known, set "
    "\"enough\" to true and tell the user, in plain words, that you have enough to set the project "
    "up. Never name a field or a flag in your reply. No project exists until the user presses "
    "Start on the next screen; the conversation is kept as a draft meanwhile.\n\n"
    # Sean, 10 Oct (email 1): an email draft arrived mixed into the explanation.
    "When the user asks for a piece of writing they could use as it stands — an email, a message, "
    "a paragraph — put that text alone in \"draft\", ready to copy, and use \"reply\" only to say "
    "in a sentence or two what it is and what you assumed. Otherwise leave \"draft\" empty.\n\n"
    + LINKS_RULE + "\n\n"
    + PROMPTMASTER_SELF_MODEL
)


class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=200_000)


class DraftBrief(BaseModel):
    objective: str = Field(default="", max_length=4_000)
    audience: str = Field(default="", max_length=1_000)
    requirements: list[str] = Field(default_factory=list, max_length=MAX_LIST)
    evidence: list[str] = Field(default_factory=list, max_length=MAX_LIST)
    deliverables: list[str] = Field(default_factory=list, max_length=MAX_LIST)
    stages: list[str] = Field(default_factory=list, max_length=MAX_LIST)
    approvals: list[str] = Field(default_factory=list, max_length=MAX_LIST)


class FrontDoorTurn(BaseModel):
    reply: str = Field(max_length=8_000)
    #: A piece of writing the user can use as it stands, apart from the reply (10 Oct, email 1).
    draft: str = Field(default="", max_length=20_000)
    brief: DraftBrief
    ready: bool = False


def build_front_door_prompt(turns: list[Turn], brief: DraftBrief) -> tuple[str, str]:
    convo = "\n".join(f"{'USER' if t.role == 'user' else 'YOU'}: {t.content.strip()}" for t in turns[-MAX_TURNS:])
    user = (
        f"THE CONVERSATION SO FAR:\n{convo}\n\n"
        f"THE DRAFT BRIEF SO FAR (update it; keep what still holds):\n{brief.model_dump_json()}\n\n"
        'Return JSON only: {"reply": "your next message", "brief": {"objective": "", "audience": "", '
        '"requirements": [], "evidence": [], "deliverables": [], "stages": [], "approvals": []}, "draft": "", "enough": false}'
    )
    return _SYSTEM, user


_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _clean(items: object, limit: int = 600) -> list[str]:
    out: list[str] = []
    for i in items if isinstance(items, list) else []:
        text = " ".join(str(i or "").split())[:limit]
        if text and text not in out:
            out.append(text)
    return out[:MAX_LIST]


def _said(item: str, user_text: str) -> bool:
    """Every figure in a fact or requirement must appear in what the user wrote."""
    numbers = [n.replace(",", "") for n in _NUMBER.findall(item)]
    return all(n in user_text for n in numbers)


def parse_front_door(result: object, turns: list[Turn]) -> FrontDoorTurn:
    if not isinstance(result, dict):
        return FrontDoorTurn(reply="Sorry — could you say that again?", brief=DraftBrief())
    raw = result.get("brief") if isinstance(result.get("brief"), dict) else {}
    user_text = " ".join(t.content for t in turns if t.role == "user").lower().replace(",", "")
    requirements = [r for r in _clean(raw.get("requirements")) if _said(r, user_text)]
    norm = lambda t: re.sub(r"[^a-z0-9$%]+", " ", t.lower()).strip()  # noqa: E731
    required = {norm(r) for r in requirements}
    brief = DraftBrief(
        objective=" ".join(str(raw.get("objective") or "").split())[:4_000],
        audience=" ".join(str(raw.get("audience") or "").split())[:1_000],
        requirements=requirements,
        # A requirement is not listed again as a fact the user gave.
        evidence=[e for e in _clean(raw.get("evidence")) if _said(e, user_text) and norm(e) not in required],
        deliverables=_clean(raw.get("deliverables"), 300),
        stages=_clean(raw.get("stages"), 120),
        approvals=_clean(raw.get("approvals"), 200),
    )
    return FrontDoorTurn(
        reply=_plain(str(result.get("reply") or "").strip())[:8_000] or "Tell me more about what you want to get done.",
        draft=str(result.get("draft") or "").strip()[:20_000],
        brief=brief,
        ready=bool(result.get("enough", result.get("ready"))) and bool(brief.objective),
    )


# "Ready is true" (Sean, 10 Oct, email 1): a sentence that names the flag is the
# model talking about its own output, not to the user.
_FLAG_TALK = re.compile(r"[^.!?\n]*\b(?:ready|enough)\b\s*(?:is|=|:|to)\s*(?:true|false)\b[^.!?\n]*[.!?]?", re.I)


def _plain(reply: str) -> str:
    cleaned = _FLAG_TALK.sub("", reply)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip() or reply


async def front_door_turn(client: OpenRouterClient, model: str | None, turns: list[Turn], brief: DraftBrief) -> FrontDoorTurn:
    system, user = build_front_door_prompt(turns, brief)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0.4, max_tokens=2_000, model=model)
    return parse_front_door(result, turns)
