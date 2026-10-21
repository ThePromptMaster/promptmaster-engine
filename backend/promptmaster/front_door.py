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
    "Make it a project; the conversation is kept as a draft meanwhile.\n\n"
    # 14 Oct call: the brief beside the chat is an outline the user can edit.
    "The user can edit the brief themselves. A part they edited is theirs: keep it exactly as "
    "they wrote it, and add to it only from what they say next.\n\n"
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


#: The brief's parts a user can edit in the outline beside the chat.
BRIEF_FIELDS = ("objective", "audience", "requirements", "evidence", "deliverables", "stages", "approvals")

#: How much attached material goes into one turn's prompt.
MAX_MATERIAL = 40_000


def build_front_door_prompt(
    turns: list[Turn], brief: DraftBrief, edited: list[str] | None = None, material: str = ""
) -> tuple[str, str]:
    convo = "\n".join(f"{'USER' if t.role == 'user' else 'YOU'}: {t.content.strip()}" for t in turns[-MAX_TURNS:])
    owned = [f for f in BRIEF_FIELDS if f in (edited or [])]
    user = (
        f"THE CONVERSATION SO FAR:\n{convo}\n\n"
        + (f"WHAT THE USER ATTACHED (their own material; it counts as something they said):\n{material.strip()[:MAX_MATERIAL]}\n\n" if material.strip() else "")
        + f"THE DRAFT BRIEF SO FAR (update it; keep what still holds):\n{brief.model_dump_json()}\n\n"
        + (f"THE USER EDITED THESE PARTS OF THE BRIEF THEMSELVES — keep them as written: {', '.join(owned)}\n\n" if owned else "")
        + 
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


def parse_front_door(
    result: object,
    turns: list[Turn],
    *,
    given: DraftBrief | None = None,
    edited: list[str] | None = None,
    material: str = "",
) -> FrontDoorTurn:
    if not isinstance(result, dict):
        return FrontDoorTurn(reply="Sorry — could you say that again?", brief=given or DraftBrief())
    raw = result.get("brief") if isinstance(result.get("brief"), dict) else {}
    # What the user wrote, typed into the outline or attached counts as said.
    typed = " ".join(" ".join(getattr(given, f)) if isinstance(getattr(given, f), list) else getattr(given, f) for f in (edited or []) if given and f in BRIEF_FIELDS)
    user_text = " ".join([*(t.content for t in turns if t.role == "user"), typed, material]).lower().replace(",", "")
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
    if given and edited:
        brief = _keep_edits(brief, given, edited)
    return FrontDoorTurn(
        reply=_plain(str(result.get("reply") or "").strip())[:8_000] or "Tell me more about what you want to get done.",
        draft=str(result.get("draft") or "").strip()[:20_000],
        brief=brief,
        ready=bool(result.get("enough", result.get("ready"))) and bool(brief.objective),
    )


def _keep_edits(brief: DraftBrief, given: DraftBrief, edited: list[str]) -> DraftBrief:
    """A part of the outline the user edited stays as they wrote it (14 Oct call).

    Code, not the prompt, guarantees it: a text field keeps the user's words; a
    list keeps every item the user wrote, and the model may only add to it.
    """
    out = brief.model_copy()
    for field in BRIEF_FIELDS:
        if field not in edited:
            continue
        mine = getattr(given, field)
        if isinstance(mine, list):
            setattr(out, field, (list(mine) + [i for i in getattr(brief, field) if i not in mine])[:MAX_LIST])
        else:
            setattr(out, field, mine)
    return out


# "Ready is true" (Sean, 10 Oct, email 1): a sentence that names the flag is the
# model talking about its own output, not to the user.
_FLAG_TALK = re.compile(r"[^.!?\n]*\b(?:ready|enough)\b\s*(?:is|=|:|to)\s*(?:true|false)\b[^.!?\n]*[.!?]?", re.I)


def _plain(reply: str) -> str:
    cleaned = _FLAG_TALK.sub("", reply)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip() or reply


async def front_door_turn(
    client: OpenRouterClient,
    model: str | None,
    turns: list[Turn],
    brief: DraftBrief,
    edited: list[str] | None = None,
    material: str = "",
) -> FrontDoorTurn:
    system, user = build_front_door_prompt(turns, brief, edited, material)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0.4, max_tokens=2_000, model=model)
    return parse_front_door(result, turns, given=brief, edited=edited, material=material)
