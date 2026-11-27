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

#: The request asks for the whole process by name (19 Nov, a client: "I explicitly
#: requested the full project workflow" and got the one-stage view, because the
#: staff announcement in it was to be "under 150 words").
_FULL_PROCESS = re.compile(
    r"\b(?:full|whole|entire)\s+(?:promptmaster\s+)?(?:project|workflow|process)\b"
    r"|\bbuild\s+(?:a|the)\s+(?:full\s+|whole\s+|staged\s+)?project\b"
    r"|\bstaged\s+workflow\b",
    re.I,
)
_LIST_ITEM = re.compile(r"^\s*(?:\d{1,2}[.)]|[-*\u2022])\s+\S", re.M)
_DELIVERABLES_LINE = re.compile(r"^\s*deliverables?\s*:\s*(.+)$", re.I | re.M)
_SEVERAL = re.compile(
    r"\b(?:two|three|four|five|six|seven|eight|nine|ten|[2-9])\s+(?:[\w-]+\s+){0,3}?(?:documents|deliverables|pieces|outputs)\b",
    re.I,
)


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
    #: Emails to a list (26 Nov): the start uses the Outreach workflow as it stands.
    outreach: bool = False


def _amount(match: re.Match[str]) -> float:
    value = float(match.group(1).replace(",", ""))
    return value * 1_000 if match.group(2) else value


def stated_words(text: str) -> int | None:
    """The largest length the request states for the piece, in words, or None."""
    found = [_amount(m) for m in _WORDS.finditer(text)] + [_amount(m) * WORDS_PER_PAGE for m in _PAGES.finditer(text)]
    return int(max(found)) if found else None


#: Emails to a list (26 Nov): each one is short, but the work is the list, the research, approval and sending.
_OUTREACH = re.compile(
    r"\b(outreach|cold[- ]e-?mails?|e-?mail campaign|mail ?merge|prospecting)\b"
    r"|\b(personal|personali[sz]ed|custom|individual|tailored)\s+(notes?|e-?mails?|messages?)\b[^.\n]{0,40}\b(to|for)\s+each\b"
    r"|\b(to|for|at)\s+each\s+(contact|company|person|lead|prospect|row|name|recipient|firm)\b"
    r"|\b(list|csv|spreadsheet|export|clay)\b[^\n]{0,120}\b(e-?mail them|write to (them|each)|reach out|personal notes?|send (them|it|each|out))\b"
    r"|\be-?mails?\b[^.\n]{0,40}\b(\d{1,4}|these|those|all (of )?(the |my |our )?)\s*(prospects|leads|contacts|companies|firms|names|rows)\b",
    re.I,
)


def is_outreach(text: str) -> bool:
    """Emails to a list of people or companies: never the one-stage workflow."""
    return bool(_OUTREACH.search(text or ""))


def asks_full_process(text: str) -> bool:
    """The request names the full project, workflow or process."""
    return bool(_FULL_PROCESS.search(text))


def several_deliverables(text: str) -> bool:
    """The request lists two or more deliverables: a stated length is then one piece's, not the work's."""
    line = _DELIVERABLES_LINE.search(text)
    if line and sum(1 for part in re.split(r"[;,]", line.group(1)) if part.strip()) >= 2:
        return True
    if re.search(r"\bdeliverables\b", text, re.I) and len(_LIST_ITEM.findall(text)) >= 2:
        return True
    return bool(_SEVERAL.search(text))


def size_by_rule(description: str) -> SizeResponse | None:
    """What the request's own words settle. None when they settle nothing.

    A length decides "concise" only for a request that is one piece: one that
    names the full process or lists several deliverables is read, and the full
    process is never concise (19 Nov).
    """
    text = description.strip()
    words = stated_words(text)
    chapters = _CHAPTERS.search(text)
    if chapters or (words is not None and words >= FULL_WORDS):
        said = f"{chapters.group(1)} chapters" if chapters else f"about {words:,} words"
        return SizeResponse(depth="full", reason=f"The request asks for {said}, which is long work.", by="rule")
    one_piece = not asks_full_process(text) and not several_deliverables(text) and not is_outreach(text)
    if one_piece and words is not None and words <= CONCISE_WORDS:
        return SizeResponse(depth="concise", reason=f"The request asks for about {words:,} words, which is one sitting.", by="rule")
    return None


def at_least_standard(size: SizeResponse, description: str) -> SizeResponse:
    """A request for the full process is never the one-stage workflow, whatever a reading said."""
    if size.depth == "concise" and asks_full_process(description):
        return SizeResponse(depth="standard", reason="The request asks for the full project workflow.", by="rule")
    if size.depth == "concise" and is_outreach(description):
        return SizeResponse(depth="standard", reason="The request is emails to a list, each found, approved and sent.", by="rule")
    return size


SIZE_INSTRUCTION = (
    "Someone has asked an assistant for a piece of work. Say how much process the work needs, from the "
    "request alone. Judge the work, not how long the request is: a long brief can ask for a short memo.\n\n"
    "concise: one piece a capable person writes in one sitting and checks once. One email, a message, a "
    "short memo or note, a summary, an answer to a question, a one-page brief, a screen or assessment of "
    "one thing against a few stated criteria using only what was supplied, a short list, a rewrite of "
    "supplied text.\n\n"
    "standard: one deliverable that needs separate work before it is written, or a real review after: a "
    "report or proposal that has to be researched or analysed first, a plan with several parts that must "
    "agree, a decision document weighing several options with figures, a package of a few documents, "
    "emails to a list of people or companies (outreach).\n\n"
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
    return at_least_standard(parse_size(result), req.description)
