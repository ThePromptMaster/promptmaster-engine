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

import logging
import re

from pydantic import BaseModel, Field

from .llm_client import NotJSONError, OpenRouterClient, OpenRouterError
from .schemas import ChatMessage, PMInput, SavedSource
from .project_context import highest_source_number
from .self_model import PROMPTMASTER_SELF_MODEL
from .catchphrases import without_repeated_catchphrases
from .source_access import links_rule
from .web_search import (
    WebSource,
    chat_web_line,
    decide_chat_search,
    found_block,
    numbered_found,
    search_web,
    strip_unknown_citations,
)

logger = logging.getLogger(__name__)

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
    "{links}\n\n"
    + PROMPTMASTER_SELF_MODEL
)


def front_door_system(web_access: str = "off") -> str:
    """The front door's instructions, with what PromptMaster can read for this
    Web access — "cannot open web pages" beside "web search: on" told the model
    both (23 Oct)."""
    return _SYSTEM.replace("{links}", links_rule(web_access), 1)


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
    #: What this turn searched the web for, or "" when it did not (22 Oct).
    web_query: str = ""
    #: The search's sources not yet found in this conversation, in the order
    #: they are cited ([S n+1]…): saved to the project when it is made.
    web_sources: list[WebSource] = Field(default_factory=list)
    #: Set when a search was wanted but failed: the reply was made without it.
    web_note: str = ""


#: The brief's parts a user can edit in the outline beside the chat.
BRIEF_FIELDS = ("objective", "audience", "requirements", "evidence", "deliverables", "stages", "approvals")

#: How much attached material goes into one turn's prompt.
MAX_MATERIAL = 40_000


def build_front_door_prompt(
    turns: list[Turn],
    brief: DraftBrief,
    edited: list[str] | None = None,
    material: str = "",
    *,
    web: str = "",
    found: str = "",
    web_access: str = "off",
) -> tuple[str, str]:
    convo = "\n".join(f"{'USER' if t.role == 'user' else 'YOU'}: {t.content.strip()}" for t in turns[-MAX_TURNS:])
    owned = [f for f in BRIEF_FIELDS if f in (edited or [])]
    user = (
        f"THE CONVERSATION SO FAR:\n{convo}\n\n"
        + (f"WHAT THE USER ATTACHED (their own material; it counts as something they said):\n{material.strip()[:MAX_MATERIAL]}\n\n" if material.strip() else "")
        + f"THE DRAFT BRIEF SO FAR (update it; keep what still holds):\n{brief.model_dump_json()}\n\n"
        + (f"THE USER EDITED THESE PARTS OF THE BRIEF THEMSELVES — keep them as written: {', '.join(owned)}\n\n" if owned else "")
        + (f"{web}\n\n" if web else "")
        + (f"{found}\n\n" if found else "")
        + 
        'Return JSON only: {"reply": "your next message", "brief": {"objective": "", "audience": "", '
        '"requirements": [], "evidence": [], "deliverables": [], "stages": [], "approvals": []}, "draft": "", "enough": false}'
    )
    return front_door_system(web_access), user


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
    web_access: str = "off",
    sources: list[SavedSource] | None = None,
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
    ready = bool(result.get("enough", result.get("ready"))) and bool(brief.objective)
    return FrontDoorTurn(
        reply=without_repeated_catchphrases(
            _plain(str(result.get("reply") or "").strip())[:8_000],
            [t.content for t in turns if t.role == "assistant"],
            chat=True,
        )
        or _no_reply(brief, ready),
        draft=str(result.get("draft") or "").strip()[:20_000],
        brief=brief,
        ready=ready,
    )


def _no_reply(brief: DraftBrief, ready: bool) -> str:
    """When the model wrote a brief but no reply (Sean, 23 Oct: a full brief
    came back with "Tell me more about what you want to get done"), say what
    the brief now holds rather than asking for it again."""
    if ready:
        return "I have enough to set the project up — check the outline beside this, then press Make it a project."
    if brief.objective:
        return "I've updated the outline beside this. What else should the project take into account?"
    return "Tell me more about what you want to get done."


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


async def _answer(
    client: OpenRouterClient,
    model: str | None,
    turns: list[Turn],
    brief: DraftBrief,
    edited: list[str] | None,
    material: str,
    web_access: str,
    found: str,
) -> tuple[dict, str, bool]:
    """The turn's JSON, asked for again rather than lost (Sean, 23 Oct: a full
    brief with pricing results came back as "Tell me more about what you want
    to get done").

    With search results in the prompt the model sometimes answered in prose,
    and sometimes the provider's content filter returned nothing. So: the
    turn; again, insisting on JSON; then once more without the results. The
    result, the last prose answer (used as the reply when no JSON came), and
    whether the results had to be left out.
    """
    strict = "\n\nAnswer with the JSON object only — no prose before or after it, even when citing sources."
    tries = [(found, ""), (found, strict)] + ([("", strict)] if found else [])
    prose, last_error = "", None
    for i, (results, extra) in enumerate(tries):
        system, user = build_front_door_prompt(
            turns, brief, edited, material, web=chat_web_line(web_access), found=results, web_access=web_access
        )
        try:
            # A long brief plus a block of results did not fit 2,000 tokens (23 Oct).
            result, _usage = await client.generate_json(prompt=user, system=system + extra, temperature=0.4, max_tokens=4_000, model=model)
        except NotJSONError as e:
            prose, last_error = e.content or prose, e
            continue
        except OpenRouterError as e:
            last_error = e
            continue
        if isinstance(result, dict) and (str(result.get("reply") or "").strip() or isinstance(result.get("brief"), dict)):
            return result, prose, bool(found) and not results
        last_error = None
    if prose:
        return {}, prose, False
    if last_error:
        raise last_error
    return {}, "", False


async def front_door_turn(
    client: OpenRouterClient,
    model: str | None,
    turns: list[Turn],
    brief: DraftBrief,
    edited: list[str] | None = None,
    material: str = "",
    web_access: str = "off",
    sources: list[SavedSource] | None = None,
) -> FrontDoorTurn:
    web_query, new_sources, web_note, found = "", [], "", ""
    saved = sources or []
    if web_access == "on":
        # The side chat's search (22 Oct, client: "I don't think the internet
        # works with the initial chatbox"): the same decision and search, with
        # the conversation standing in for a project that does not exist yet.
        asked = next((t.content for t in reversed(turns) if t.role == "user"), "")
        # The brief's objective, or the start of what was asked: the search's
        # context, kept short so it does not become what is searched (23 Oct).
        inputs = PMInput(objective=(brief.objective or asked[:300]).strip() or "A new project", mode="analyst", sources=saved)
        history = [
            ChatMessage(id=str(i), iteration_number=1, role=t.role, content=t.content, created_at="")
            for i, t in enumerate(turns[:-1][-4:])
        ]
        try:
            query = await decide_chat_search(client, model, inputs, history, asked[:4_000], "")
            if query:
                result = await search_web(client, model, inputs, query, purpose=asked[:300])
                web_query, found = query, found_block(saved, query, result)
                new_sources = [s for _n, s, new in numbered_found(saved, result.sources) if new]
        except (OpenRouterError, ValueError, AttributeError) as e:
            logger.warning("front door web search failed: %s", e)
            web_note = "The web search failed, so this reply uses only what you have said."
    result, prose, dropped = await _answer(client, model, turns, brief, edited, material, web_access, found)
    if dropped:
        new_sources, web_note = [], "The search results could not be used in this reply, so it uses only what you have said."
    turn = parse_front_door(result, turns, given=brief, edited=edited, material=material)
    if prose and not str((result or {}).get("reply") or "").strip():
        # The model answered in prose: the answer stands, the outline as it was.
        turn.reply, turn.brief, turn.ready = _plain(prose.strip())[:8_000], brief, False
    if web_query:
        turn.reply = strip_unknown_citations(turn.reply, highest_source_number(saved) + len(new_sources))
    turn.web_query, turn.web_sources, turn.web_note = web_query, new_sources, web_note
    return turn
