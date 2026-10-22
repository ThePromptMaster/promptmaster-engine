"""Search the public web for a project, and keep what was found (20 Oct, Sean:
"Can we add web search and source retrieval to research workflows, with
citations and saved sources? On and off button?").

One model call with OpenRouter's web plugin. What it returns as sources are
the search engine's own results (`url_citation` annotations), never links the
model wrote: a link in the summary that is not among them is unlinked, in
code. The browser saves the sources (`project_sources`); nothing is stored here.

Off unless the project's "Web access" switch is on. The switch lives in the
database and the browser sends it; the backend is stateless (CLAUDE.md), so
it refuses a request that does not say "on" rather than reading the row (L-97).
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .schemas import ChatMessage, PMInput, SavedSource

MAX_RESULTS = 5
MAX_EXCERPT = 600

_SEARCH_SYSTEM = (
    "You search the public web for a PromptMaster project and report what the search found. "
    "Use only what the search results say. Follow every claim with the link of the result it "
    "comes from. If the results do not answer the question, say so plainly. Never invent a "
    "source, a figure or a link, and never fill a gap from memory."
)


class WebSource(BaseModel):
    url: str = Field(max_length=2_000)
    title: str = Field(default="", max_length=300)
    #: What the search returned from the page, clipped.
    excerpt: str = Field(default="", max_length=MAX_EXCERPT)


class WebSearchResult(BaseModel):
    summary: str = ""
    sources: list[WebSource] = Field(default_factory=list)


def build_search_prompt(inputs: PMInput, query: str, purpose: str = "") -> tuple[str, str]:
    user = (
        f"PROJECT OBJECTIVE: {inputs.objective}\n"
        + (f"WHAT THIS SEARCH IS FOR: {purpose}\n" if purpose.strip() else "")
        + f"SEARCH FOR: {query}\n\n"
        "Write a short summary, at most 200 words, of what the results say that bears on this. "
        "Put each result's link after the claim it supports."
    )
    return _SEARCH_SYSTEM, user


def sources_from(annotations: list[dict[str, Any]]) -> list[WebSource]:
    """The search's own results, once each, web links only."""
    out: list[WebSource] = []
    seen: set[str] = set()
    for a in annotations:
        cite = a.get("url_citation") if isinstance(a.get("url_citation"), dict) else a
        url = str(cite.get("url") or "").strip()
        if not re.match(r"^https?://", url) or url in seen:
            continue
        seen.add(url)
        excerpt = " ".join(str(cite.get("content") or "").split())
        out.append(WebSource(
            url=url[:2_000],
            title=" ".join(str(cite.get("title") or "").split())[:300],
            excerpt=excerpt if len(excerpt) <= MAX_EXCERPT else f"{excerpt[:MAX_EXCERPT - 1].rstrip()}…",
        ))
    return out


_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
#: A bare link, without the sentence's closing punctuation.
_BARE = re.compile(r"(?<![(\[])https?://[^\s)\]]*[^\s)\].,;:!?]")


def keep_found_links(summary: str, sources: list[WebSource]) -> str:
    """A link in the summary that the search did not return is unlinked: the
    model may not add a source of its own."""
    found = {s.url for s in sources}
    text = _LINK.sub(lambda m: m.group(0) if m.group(2) in found else m.group(1), summary)
    return _BARE.sub(lambda m: m.group(0) if m.group(0) in found else "", text).strip()


_CITE = re.compile(r"\[S(\d{1,3})\]")


def strip_unknown_citations(text: str, count: int) -> str:
    """A citation to a source the project does not hold is removed: "[S7]"
    with five sources saved points at nothing (20 Oct)."""
    return _CITE.sub(lambda m: m.group(0) if 1 <= int(m.group(1)) <= count else "", text)


async def search_web(
    client: OpenRouterClient, model: str | None, inputs: PMInput, query: str, purpose: str = "", max_results: int = MAX_RESULTS
) -> WebSearchResult:
    system, user = build_search_prompt(inputs, query, purpose)
    content, annotations = await client.generate_with_web(user, system=system, model=model, max_results=max_results)
    sources = sources_from(annotations)
    return WebSearchResult(summary=keep_found_links(content, sources)[:4_000], sources=sources)


# --------------------------------------------------------------------------
# The side chat's search (22 Oct): the chat decides, while Web access is on.
# --------------------------------------------------------------------------

_CHAT_DECIDE_SYSTEM = (
    "You decide whether a question in a PromptMaster project's side chat needs a search of the "
    "public web before it is answered. Search only for current or outside facts — figures, events, "
    "people, organisations, prices, laws, publications — that the project's accepted facts, its "
    "saved sources and the current version do not already settle. Do not search for a question "
    "about the document itself (its wording, structure, length or tone), for an opinion, or for "
    "anything the user has just told you. Reply in JSON: "
    '{"search": true or false, "query": "the words to search for, at most 12, or empty"}.'
)


def build_chat_decision_prompt(
    inputs: PMInput, chat_history: list[ChatMessage], user_message: str, current: str
) -> tuple[str, str]:
    saved = "\n".join(f"- {s.title or s.url}" for s in inputs.sources) or "(none)"
    facts = "\n".join(f"- {f.statement}" for f in inputs.facts) or "(none)"
    recent = "\n".join(f"{'User' if m.role == 'user' else 'Assistant'}: {m.content[:400]}" for m in chat_history[-4:])
    user = (
        f"PROJECT OBJECTIVE: {inputs.objective}\n"
        f"ACCEPTED FACTS:\n{facts}\n"
        f"SAVED SOURCES:\n{saved}\n"
        f"CURRENT VERSION (start):\n{current[:1_500]}\n\n"
        + (f"RECENT CHAT:\n{recent}\n\n" if recent else "")
        + f"THE USER ASKS:\n{user_message}\n\n"
        "Does answering this need a web search? If so, what should be searched for?"
    )
    return _CHAT_DECIDE_SYSTEM, user


async def decide_chat_search(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    chat_history: list[ChatMessage],
    user_message: str,
    current: str,
) -> str | None:
    """The words to search for, or None when the question needs no search."""
    system, user = build_chat_decision_prompt(inputs, chat_history, user_message, current)
    data, _usage = await client.generate_json(user, system=system, temperature=0.0, max_tokens=200, model=model)
    query = " ".join(str(data.get("query") or "").split())[:400]
    return query if data.get("search") is True and len(query) >= 2 else None


def numbered_found(saved: list[SavedSource], found: list[WebSource]) -> list[tuple[int, WebSource, bool]]:
    """Each found source with the number it has once saved, and whether it is new.

    A link already on record keeps its number; new ones follow the saved ones
    in order — what `saveSources` appends, so [S6] in the reply is [S6] on the
    page after the save.
    """
    have = {s.url: i for i, s in enumerate(saved, start=1)}
    out: list[tuple[int, WebSource, bool]] = []
    nxt = len(saved)
    for s in found:
        if s.url in have:
            out.append((have[s.url], s, False))
        else:
            nxt += 1
            have[s.url] = nxt
            out.append((nxt, s, True))
    return out


FOUND_HEADER = (
    "NEW WEB RESULTS — a search just made for this question. They will be saved to the project "
    "with these numbers. Cite each claim you take from them as [S#] after the claim; use only what "
    "they say. If they do not answer the question, say so plainly rather than filling the gap."
)


def found_block(saved: list[SavedSource], query: str, result: WebSearchResult) -> str:
    """The fresh search, numbered as it will be saved, for the chat reply's prompt."""
    lines = [f"{FOUND_HEADER}\nSEARCHED FOR: {query}"]
    for n, s, _new in numbered_found(saved, result.sources):
        lines.append(f"[S{n}] {s.title or s.url} — {s.url}" + (f"\n  {s.excerpt}" if s.excerpt else ""))
    if not result.sources:
        lines.append("(the search returned no sources)")
    return "\n".join(lines)
