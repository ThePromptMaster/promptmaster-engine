"""Looking a named work up in a public index (OpenAlex).

The Literature stage's works are recalled from a model's knowledge: nothing
was searched, and a recalled citation can be misremembered or not exist (the
client's 1 Oct feedback, item 12: "How are candidate literature references
supposed to become verified literature?"). This is the first step of that: for
each named work, ask OpenAlex whether a record with that title exists, and if
one does, return its real title, authors, year and DOI.

What a match means, exactly: **a record matching the name was found.** It does
not mean the work says what the row claims it says — nobody has read it. The
status this feeds is therefore "Retrieved", not "Verified"; verifying stays
the user's.

Stateless and keyless: one GET per work, nothing stored. Matching is a pure
function so it can be tested without a network.

`search_works` is the other direction (2 Oct): no work is named yet, so the
index is searched by topic and what it returns is offered. The same limit on
what that means applies: these are records the index holds for those words.
Nobody has read them, and whether each belongs is still the user's to say.
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any

import httpx
from pydantic import BaseModel, Field

OPENALEX_URL = "https://api.openalex.org/works"
#: How much of the looked-up title must be found in the named work, by word.
MATCH_THRESHOLD = 0.8
MAX_WORKS = 20
#: How many records a topic search may offer. A stage holds 15 works; a screenful is enough to choose from.
MAX_SEARCH_RESULTS = 10
_SELECT = "id,doi,display_name,publication_year,authorships"
_STOP = {"a", "an", "the", "of", "and", "in", "on", "for", "to", "with", "is", "are", "at", "by", "from", "how", "do", "does"}
_WORD = re.compile(r"[a-z0-9]+")
_YEAR = re.compile(r"\b(19|20)\d{2}\b")


class WorkQuery(BaseModel):
    id: str
    work: str = Field(max_length=600)


class WorkMatch(BaseModel):
    id: str
    found: bool = False
    title: str = ""
    authors: str = ""
    year: int | None = None
    doi: str = ""
    url: str = ""
    #: Why nothing is offered, when nothing is: "no record matched", "the search could not be reached".
    note: str = ""


_DOUBLE_QUOTED = re.compile(r"[“\"]([^”\"]{12,})[”\"]")
# A single-quoted title may hold apostrophes ("Developers' Perceptions",
# "Iceland's journey"), so it runs from the first opening quote to the LAST
# closing one, not to the first apostrophe.
_SINGLE_QUOTED = re.compile(r"(?:^|[\s(])[‘'](.{12,})[’'](?=[\s.,;:)]|$)")
_AFTER_YEAR = re.compile(r"\(?\b(?:19|20)\d{2}[a-z]?\)?[.,:]?\s+(.{12,})")
#: Characters OpenAlex's search rejects (a "?" in the query is a 400) or reads as operators.
_UNSEARCHABLE = re.compile(r"[?!*\"“”‘’'()\[\]{}|\\^~]")


def title_of(named: str) -> str:
    """The title inside a citation, which is what an index can be searched by.

    A whole citation — authors, year, title, journal — searched as one string
    returns works *about* the same things, not the work itself: tried against
    OpenAlex on 2026-10-01, four real, well-known papers all came back not
    found until only their titles were sent. A quoted title is taken as given;
    otherwise what follows the year, up to the first full stop; otherwise the
    whole string.
    """
    named = " ".join(named.split())
    quoted = max(_DOUBLE_QUOTED.findall(named), key=len, default="")
    if not quoted:
        single = _SINGLE_QUOTED.search(named)
        quoted = single.group(1) if single else ""
    if quoted:
        return quoted.strip(" ,.")
    after = _AFTER_YEAR.search(named)
    if after:
        return after.group(1).split(". ")[0].strip(" ,.")
    return named


def search_text(title: str) -> str:
    """The title as it can be sent to the index: no characters it rejects or reads as operators."""
    return " ".join(_UNSEARCHABLE.sub(" ", title).split())


def _words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1}


def title_overlap(named: str, title: str) -> float:
    """The share of the record's title words that appear in the named work.

    Measured against the record's title, not the name: the name carries authors,
    a year and a journal as well, so most of *its* words are never in a title.
    """
    wanted = _words(title)
    if not wanted:
        return 0.0
    return len(wanted & _words(named)) / len(wanted)


def best_match(named: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The first result whose title is really in the named work, and whose year agrees if the name gives one.

    A year in the name that disagrees with the record is a different work (a
    later edition, or a different paper by the same people), so it is refused
    rather than offered as "retrieved".
    """
    named_years = {int(m.group(0)) for m in _YEAR.finditer(named)}
    for record in results:
        title = str(record.get("display_name") or record.get("title") or "")
        # A one- or two-word title matches too easily to mean anything.
        if len(_words(title)) < 3:
            continue
        if title_overlap(named, title) < MATCH_THRESHOLD:
            continue
        year = record.get("publication_year")
        if named_years and isinstance(year, int) and all(abs(year - y) > 1 for y in named_years):
            continue
        return record
    return None


def to_match(query: WorkQuery, record: dict[str, Any] | None) -> WorkMatch:
    if record is None:
        return WorkMatch(id=query.id, found=False, note="No record with this title was found.")
    authors = [
        str((a.get("author") or {}).get("display_name") or "")
        for a in (record.get("authorships") or [])[:4]
        if isinstance(a, dict)
    ]
    doi = str(record.get("doi") or "")
    return WorkMatch(
        id=query.id,
        found=True,
        title=str(record.get("display_name") or record.get("title") or "")[:400],
        authors=", ".join(a for a in authors if a)[:300],
        year=record.get("publication_year") if isinstance(record.get("publication_year"), int) else None,
        doi=doi,
        url=doi or str(record.get("id") or ""),
    )


def _mock(query: WorkQuery) -> WorkMatch:
    """Scripted lookups for the browser tests: a work named "… 1" is found, the rest are not."""
    if re.search(r"\b1\b", query.work):
        return WorkMatch(id=query.id, found=True, title=f"{query.work} (the record)", authors="Mock, A.", year=2020,
                         doi="https://doi.org/10.0000/mock.1", url="https://doi.org/10.0000/mock.1")
    return WorkMatch(id=query.id, found=False, note="No record with this title was found.")


async def _search(http: httpx.AsyncClient, text: str, per_page: int) -> list[dict[str, Any]] | None:
    """One search of the index. None when it could not be reached, which is not the same as nothing found."""
    params = {"search": text[:300], "per-page": str(per_page), "select": _SELECT}
    mailto = os.getenv("OPENALEX_MAILTO", "").strip()
    if mailto:
        params["mailto"] = mailto
    try:
        response = await http.get(OPENALEX_URL, params=params, timeout=12.0)
        if response.status_code == 429:
            # Seven lookups at once from a shared address can trip the public
            # limit; one pause and one more try is cheaper than "try again".
            await asyncio.sleep(1.5)
            response = await http.get(OPENALEX_URL, params=params, timeout=12.0)
        response.raise_for_status()
        results = response.json().get("results") or []
    except (httpx.HTTPError, ValueError):
        return None
    return [r for r in results if isinstance(r, dict)]


async def _lookup_one(http: httpx.AsyncClient, query: WorkQuery) -> WorkMatch:
    name = " ".join(query.work.split())
    if not name:
        return WorkMatch(id=query.id, note="There is no work named on this row.")
    results = await _search(http, search_text(title_of(name)), 10)
    if results is None:
        return WorkMatch(id=query.id, note="The search could not be reached; this work was not looked up.")
    return to_match(query, best_match(name, results))


async def lookup_works(queries: list[WorkQuery], *, mock: bool = False) -> list[WorkMatch]:
    """Look each named work up. Never raises: a work that could not be looked up says so."""
    queries = queries[:MAX_WORKS]
    if mock:
        return [_mock(q) for q in queries]
    async with httpx.AsyncClient() as http:
        return list(await asyncio.gather(*(_lookup_one(http, q) for q in queries)))


def offered(results: list[dict[str, Any]], limit: int) -> list[WorkMatch]:
    """The records of a topic search worth offering: titled, not a fragment, each once, in the index's order."""
    out: list[WorkMatch] = []
    seen: set[str] = set()
    for record in results:
        title = str(record.get("display_name") or record.get("title") or "")
        # A one- or two-word title is an index entry for a term, an erratum or a section heading more often than a work.
        if len(_words(title)) < 3:
            continue
        key = " ".join(sorted(_words(title)))
        if key in seen:
            continue
        seen.add(key)
        out.append(to_match(WorkQuery(id=str(record.get("id") or f"r{len(out)}"), work=""), record))
        if len(out) >= limit:
            break
    return out


def _mock_search(limit: int) -> list[WorkMatch]:
    """Scripted search results for the browser tests."""
    return [
        WorkMatch(id=f"https://openalex.org/Wmock{n}", found=True, title=f"Mock found work {n} on the topic", authors="Mock, A.",
                  year=2020 + n, doi=f"https://doi.org/10.0000/mock.found.{n}", url=f"https://doi.org/10.0000/mock.found.{n}")
        for n in range(1, min(limit, 3) + 1)
    ]


async def search_works(query: str, limit: int = 8, *, mock: bool = False) -> tuple[list[WorkMatch], bool]:
    """Search the index by topic. Returns the records and whether the index was reached. Never raises."""
    limit = max(1, min(limit, MAX_SEARCH_RESULTS))
    if mock:
        return _mock_search(limit), True
    text = search_text(" ".join(query.split()))
    if not text:
        return [], True
    async with httpx.AsyncClient() as http:
        # More than is offered are asked for, because fragments and repeats are dropped.
        results = await _search(http, text, min(limit * 2, 25))
    if results is None:
        return [], False
    return offered(results, limit), True
