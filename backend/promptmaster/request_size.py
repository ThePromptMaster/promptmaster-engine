"""How much process a request needs, decided from the request (11 Nov).

A client, 8 Nov: "'Build a plan with me' and 'Get a first draft' should
determine how someone starts, while the actual request determines the depth and
workflow. A small request should get a concise process with the checks it
needs. A substantial request should get the full treatment, whichever starting
button someone chooses."

Until then the button decided: "Get a first draft" was always one stage, and
every other way in was a designed workflow of at least three (his concise
screening memo got seven). One answer for both: `concise` is one written stage
with the final check, `standard` a short designed workflow, `full` a long one.

What code can tell from the words is a rule; the rest is one small model call.
An unusable answer is `standard`, never an error: sizing must not stop a start.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

Depth = Literal["concise", "standard", "full"]
_DEPTHS = ("concise", "standard", "full")

#: Reading one request does not need the default model.
SIZE_MODEL = "anthropic/claude-haiku-5.5"

#: The request as typed is enough to size it; a long brief is cut for the call.
MAX_SIZED_CHARS = 6_000

#: Words stated for the finished piece, at or under which it is one sitting, and
#: at or over which it is long work whatever else the request says.
CONCISE_WORDS = 800
FULL_WORDS = 6_000

_NUMBER = r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?"
_WORDS = re.compile(_NUMBER + r"[\s-]*words?\b", re.I)
_PAGES = re.compile(_NUMBER + r"[\s-]*pages?\b", re.I)
_CHAPTERS = re.compile(r"\b(\d{1,3}|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+chapters?\b", re.I)
WORDS_PER_PAGE = 400


class SizeRequest(BaseModel):
    #: What the user asked for, in their words.
    description: str = Field(..., min_length=1, max_length=60_000)
    #: Characters of documents attached at the start: a large brief is more to work through.
    attached_chars: int = Field(default=0, ge=0)


class SizeResponse(BaseModel):
    depth: Depth = "standard"
    #: One sentence the page can show.
    reason: str = ""
    #: "rule" when the request's own words decided it, "model" when a reading did.
    by: Literal["rule", "model", "default"] = "default"


def _amount(match: re.Match[str]) -> float:
    value = float(match.group(1).replace(",", ""))
    return value * 1_000 if match.group(2) else value


def stated_words(text: str) -> int | None:
    """The largest length the request states for the piece, in words, or None."""
    found = [_amount(m) for m in _WORDS.finditer(text)] + [_amount(m) * WORDS_PER_PAGE for m in _PAGES.finditer(text)]
    return int(max(found)) if found else None


def size_by_rule(description: str) -> SizeResponse | None:
    """What the request's own words settle. None when they settle nothing."""
    text = description.strip()
    words = stated_words(text)
    chapters = _CHAPTERS.search(text)
    if chapters or (words is not None and words >= FULL_WORDS):
        said = f"{chapters.group(0)}" if chapters else f"about {words:,} words"
        return SizeResponse(depth="full", reason=f"The request asks for {said}, which is long work.", by="rule")
    if words is not None and words <= CONCISE_WORDS:
        return SizeResponse(depth="concise", reason=f"The request asks for about {words:,} words, which is one sitting.", by="rule")
    return None


SIZE_INSTRUCTION = (
    "Someone has asked an assistant for a piece of work. Say how much process the work needs, from the "
    "request alone. Judge the work, not how long the request is: a long brief can ask for a short memo.\n\n"
    "concise: one piece a capable person writes in one sitting and checks once. An email, a message, a "
    "short memo or note, a summary, an answer to a question, a one-page brief, a screen or assessment of "
    "one thing against a few stated criteria using only what was supplied, a short list, a rewrite of "
    "supplied text.\n\n"
    "standard: one deliverable that needs separate work before it is written, or a real review after: a "
    "report or proposal that has to be researched or analysed first, a plan with several parts that must "
    "agree, a decision document weighing several options with figures, a package of a few documents.\n\n"
    "full: long or many-part work. A book, a manuscript, a thesis, a long report in chapters, a study "
    "or investigation that runs over rounds, a programme of many documents.\n\n"
    "A request that says concise, brief, short or quick about the deliverable is concise unless it also "
    "asks for research, several documents or several rounds. If you are unsure between two, choose the "
    "smaller.\n\n"
    'Return JSON only: {"depth": "concise" | "standard" | "full", "reason": one short sentence saying '
    "what about the request decides it}."
)


def build_size_prompt(req: SizeRequest) -> tuple[str, str]:
    text = req.description.strip()[:MAX_SIZED_CHARS]
    attached = f"\n\nDOCUMENTS ATTACHED: about {req.attached_chars:,} characters of the user's own material." if req.attached_chars else ""
    return SIZE_INSTRUCTION, f"THE REQUEST:\n{text}{attached}"


def parse_size(result: object) -> SizeResponse:
    if not isinstance(result, dict) or result.get("depth") not in _DEPTHS:
        return SizeResponse(reason="The request could not be sized, so the usual process is used.")
    return SizeResponse(depth=result["depth"], reason=" ".join(str(result.get("reason") or "").split())[:240], by="model")


async def size_request(client: OpenRouterClient, req: SizeRequest) -> SizeResponse:
    ruled = size_by_rule(req.description)
    if ruled:
        return ruled
    system, user = build_size_prompt(req)
    try:
        result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=200, model=SIZE_MODEL)
    except Exception:  # noqa: BLE001 — sizing never stops a start
        return SizeResponse(reason="The request could not be sized, so the usual process is used.")
    return parse_size(result)
