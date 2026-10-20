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
from .schemas import PMInput

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
