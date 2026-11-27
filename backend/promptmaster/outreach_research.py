"""Filling in the blanks on an outreach list (Sean, 26 Nov: a list missing a contact's name, title,
email or a personal detail should be completed by PromptMaster, with the source shown, preferring a
named person to a general inbox, and saying why when nothing was found rather than guessing).

For up to five contacts at a time:

1. **Search** (code writes the queries from the row alone; at most two per contact): the web
   plugin's results come back with each page's text, kept whole here for the checks below.
2. **Read** (one model call, every contact together): who the right person is, their role, their
   address, one real detail of the company's work and the sentence it becomes, each with the page
   it came from; up to two candidates when it cannot tell which person is right.
3. **Check in code**, so nothing the model says reaches the list unless a page shows it:
   - an address is *verified* only when it appears, character for character, on a page the search
     returned; one no page shows is dropped;
   - a *guess* is made by code alone, from an address a page shows for a named colleague at the same
     domain (jane.doe@ → first.last@), and is always a decision for the user, never "ready";
   - a name, a role or a candidate is kept only when its page names them;
   - the detail is kept only when most of its words are on its page, and the line only with it.

The browser saves the sources with `keepFound` and writes the row (`lib/outreach/research.ts`).
Values the list already had are never replaced: research fills blanks only.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient
from .project_context import context_block, highest_source_number
from .reader_text import WRITING_RULES
from .schemas import PMInput, WebSource

logger = logging.getLogger(__name__)

MAX_ROWS = 5
SEARCHES_PER_ROW = 2
RESULTS_PER_SEARCH = 5
#: The search only gathers pages; its own summary is not used.
SEARCH_MODEL = "anthropic/claude-haiku-5.5"
#: Reading the pages for every contact at once.
READ_MODEL = "anthropic/claude-sonnet-5.5"
#: How much of a page is kept for the checks, and how much the reader is shown.
PAGE_KEPT = 30_000
PAGE_SHOWN = 3_500
EXCERPT = 600

_EMAIL = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_LINK = re.compile(r"https?://\S+")
GENERAL_INBOX = re.compile(
    r"^(info|hello|hi|contact|contactus|enquiries|enquiry|inquiries|inquiry|sales|team|office|admin|support|help|mail|press|media|marketing|careers|jobs|hr|accounts|billing|reception)@",
    re.IGNORECASE,
)


class ResearchRow(BaseModel):
    """One contact as the list has it now: only what research may need."""

    id: str = Field(max_length=100)
    company: str = Field(default="", max_length=300)
    website: str = Field(default="", max_length=500)
    domain: str = Field(default="", max_length=253)
    name: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    detail: str = Field(default="", max_length=600)


class Candidate(BaseModel):
    name: str = Field(default="", max_length=200)
    role: str = Field(default="", max_length=200)
    email: str = Field(default="", max_length=320)
    why: str = Field(default="", max_length=300)
    #: "[S n]": the page that names them.
    source: str = ""


class ResearchedRow(BaseModel):
    id: str
    name: str = ""
    role: str = ""
    email: str = ""
    #: verified: a page shows it; guess: made by code from a colleague's address; none: not found.
    email_status: Literal["", "verified", "guess", "none"] = ""
    detail: str = ""
    personal_line: str = ""
    #: Each "[S n]", renumbered by the browser as it saves the sources.
    src_name: str = ""
    src_role: str = ""
    src_email: str = ""
    src_detail: str = ""
    candidates: list[Candidate] = Field(default_factory=list)
    #: For a guess: the address it was made from and its source ("jane.doe@acme.com [S3]").
    guessed_from: str = ""
    #: Why something is missing, in plain words.
    reason: str = ""


class Page(BaseModel):
    url: str
    title: str = ""
    text: str = ""


# ---------------------------------------------------------------------------
# 1. Search
# ---------------------------------------------------------------------------


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def queries_for(row: ResearchRow) -> list[str]:
    """At most two queries, from the row's own values (never the model's words)."""
    company = _clean(row.company) or _clean(row.domain)
    domain = _clean(row.domain).lower()
    name = _clean(row.name)
    out: list[str] = []
    if not name:
        out.append(f"{company} {domain} leadership team".strip())
    elif not row.role.strip():
        out.append(f'"{name}" {company}')
    if not row.email.strip():
        if name and domain:
            out.append(f'"{name}" "@{domain}" email')
        elif domain:
            out.append(f'"@{domain}" email contact')
        else:
            out.append(f"{company} contact email")
    if not row.detail.strip() and len(out) < SEARCHES_PER_ROW:
        out.append(f"{company} {domain} news".strip())
    return [q[:300] for q in out if q.strip()][:SEARCHES_PER_ROW]


SEARCH_SYSTEM = (
    "You run a web search to complete a contact list. Reply only with the titles of the results, "
    "one per line. Add nothing of your own."
)


def pages_from(annotations: list[dict[str, Any]]) -> list[Page]:
    out: list[Page] = []
    seen: set[str] = set()
    for a in annotations:
        cite = a.get("url_citation") if isinstance(a.get("url_citation"), dict) else a
        url = str(cite.get("url") or "").strip()
        if not re.match(r"^https?://", url) or url in seen:
            continue
        seen.add(url)
        out.append(Page(url=url[:2_000], title=_clean(str(cite.get("title") or ""))[:300], text=_clean(str(cite.get("content") or ""))[:PAGE_KEPT]))
    return out


async def search_pages(client: OpenRouterClient, query: str) -> list[Page]:
    try:
        _content, annotations = await client.generate_with_web(query, system=SEARCH_SYSTEM, model=SEARCH_MODEL, max_results=RESULTS_PER_SEARCH)
    except Exception as e:  # one search failing costs its pages, not the contact
        logger.warning("OUTREACH_RESEARCH_SEARCH_FAILED %s", type(e).__name__)
        return []
    return pages_from(annotations)


# ---------------------------------------------------------------------------
# 2. Read
# ---------------------------------------------------------------------------

READ_SYSTEM = (
    "You complete an outreach contact list from web pages. You use only what the pages say. "
    "You never invent a person, a role, an address or a fact, and you never complete an address the pages do not show."
)


def _addresses(text: str) -> list[str]:
    seen: list[str] = []
    for m in _EMAIL.findall(text or ""):
        a = m.strip(".").lower()
        if a not in seen:
            seen.append(a)
    return seen


def build_read_prompt(inputs: PMInput, brief: str, rows: list[ResearchRow], pages: dict[str, list[Page]]) -> str:
    """Asserted on in tests, never the model's output."""
    blocks: list[str] = []
    for row in rows:
        known = "; ".join(f"{k}: {getattr(row, k)}" for k in ("company", "website", "domain", "name", "role", "email", "detail") if getattr(row, k).strip()) or "(nothing)"
        lines = [f"CONTACT id={row.id}", f"The list has: {known}"]
        for i, p in enumerate(pages.get(row.id, []), start=1):
            found = _addresses(p.text)
            lines.append(
                f"[P{i}] {p.title} — {p.url}\n"
                + (f"Addresses on this page: {', '.join(found[:20])}\n" if found else "")
                + p.text[:PAGE_SHOWN]
            )
        if len(lines) == 2:
            lines.append("(the search returned no pages for this contact)")
        blocks.append("\n".join(lines))
    return "\n\n".join(
        part
        for part in [
            context_block(inputs),
            "THE OUTREACH BRIEF (the user's):\n" + (brief.strip()[:4_000] or "(none written)"),
            "THE CONTACTS AND THE PAGES FOUND FOR EACH:\n\n" + "\n\n---\n\n".join(blocks),
            (
                "For each contact, fill only what the list does not have, from that contact's pages:\n"
                "- `name` and `role`: the one person the brief should write to at this company. Prefer a named person "
                "to a general inbox. Give the page (`name_page`, `role_page`: the number after P) that names them.\n"
                "- `email`: an address exactly as a page shows it, with `email_page`. Never complete or guess an address. "
                "If a page shows a general inbox (info@, hello@ …) and no personal address, give that.\n"
                "- `owners`: other addresses at the company's domain that a page shows, with the name of the person each "
                "belongs to when the page says so: [{\"email\": \"…\", \"name\": \"…\", \"page\": 2}].\n"
                "- `detail`: one real, recent thing about the company's work, in the page's own words, with `detail_page`; "
                "and `personal_line`: one short sentence for the email built only on that detail, with no praise it does not support.\n"
                "- `candidates`: when two people could be right, up to two, each with `name`, `role`, `email` (only if a page shows it), "
                "`why` (one line on why they might be the one) and `page`.\n"
                "- `not_found`: when a value could not be found, say why in one line (no page names anyone; the site "
                "lists only a contact form …). Leave a field empty rather than guess."
            ),
            WRITING_RULES,
            (
                'Return JSON: {"rows": [{"id": "…", "name": "", "name_page": 0, "role": "", "role_page": 0, '
                '"email": "", "email_page": 0, "owners": [], "detail": "", "detail_page": 0, "personal_line": "", '
                '"candidates": [], "not_found": ""}]}'
            ),
        ]
        if part
    )


# ---------------------------------------------------------------------------
# 3. Check
# ---------------------------------------------------------------------------

_STOP = {"the", "and", "for", "with", "from", "that", "this", "their", "they", "have", "has", "into", "over", "about", "its", "our", "your", "of", "to", "in", "on", "at", "a", "an", "by", "is", "are", "was", "were"}


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2 and w not in _STOP]


def _on_page(value: str, page: Page | None) -> bool:
    if not page or not value.strip():
        return False
    return _clean(value).lower() in (page.text + " " + page.title).lower()


def _role_on_page(role: str, page: Page | None) -> bool:
    if not page:
        return False
    words = _words(role)
    hay = (page.text + " " + page.title).lower()
    return bool(words) and all(w in hay for w in words)


def _grounded(detail: str, page: Page | None, share: float = 0.6) -> bool:
    if not page:
        return False
    words = _words(detail)
    if len(words) < 3:
        return False
    hay = set(_words(page.text + " " + page.title))
    return sum(1 for w in words if w in hay) / len(words) >= share


def _page(pages: list[Page], n: Any) -> Page | None:
    try:
        i = int(n)
    except (TypeError, ValueError):
        return None
    return pages[i - 1] if 1 <= i <= len(pages) else None


def _showing(pages: list[Page], value: str, prefer: Page | None, test=_on_page) -> Page | None:
    if prefer and test(value, prefer):
        return prefer
    return next((p for p in pages if test(value, p)), None)


def _name_parts(name: str) -> tuple[str, str]:
    parts = [p for p in re.findall(r"[a-z]+", _clean(name).lower()) if p]
    return (parts[0], parts[-1]) if len(parts) >= 2 else ("", "")


#: Local-part patterns, tried in this order.
PATTERNS: dict[str, Any] = {
    "first.last": lambda f, l: f"{f}.{l}",
    "firstlast": lambda f, l: f"{f}{l}",
    "first_last": lambda f, l: f"{f}_{l}",
    "flast": lambda f, l: f"{f[0]}{l}",
    "f.last": lambda f, l: f"{f[0]}.{l}",
    "firstl": lambda f, l: f"{f}{l[0]}",
    "first": lambda f, l: f,
}


def pattern_of(address: str, owner: str) -> str:
    """The pattern an address follows for its owner's name, or ''."""
    local = address.split("@", 1)[0].lower()
    first, last = _name_parts(owner)
    if not first:
        return ""
    return next((key for key, make in PATTERNS.items() if make(first, last) == local), "")


def apply_pattern(pattern: str, name: str, domain: str) -> str:
    first, last = _name_parts(name)
    if not first or pattern not in PATTERNS or not domain:
        return ""
    return f"{PATTERNS[pattern](first, last)}@{domain}"


def inbox_kind(address: str) -> Literal["", "named", "general"]:
    if not address:
        return ""
    return "general" if GENERAL_INBOX.match(address) else "named"


def _window(page: Page, needle: str) -> str:
    """The part of a page around what was checked, for the saved source."""
    text = page.text
    at = text.lower().find(needle.lower()) if needle else -1
    if at < 0:
        return text[:EXCERPT]
    start = max(0, at - EXCERPT // 2)
    piece = text[start : start + EXCERPT]
    return ("…" if start else "") + piece + ("…" if start + EXCERPT < len(text) else "")


def _sentence(text: str, limit: int = 220) -> str:
    text = _LINK.sub("", _EMAIL.sub("", _clean(text))).strip()
    return text if len(text) <= limit else ""


class _Cites:
    """The pages the kept values rest on, numbered after the project's own sources."""

    def __init__(self, start: int) -> None:
        self.start = start
        self.order: list[tuple[Page, str]] = []

    def cite(self, page: Page, needle: str) -> str:
        for i, (p, _n) in enumerate(self.order):
            if p.url == page.url:
                return f"[S{self.start + i + 1}]"
        self.order.append((page, needle))
        return f"[S{self.start + len(self.order)}]"

    def sources(self) -> list[WebSource]:
        return [WebSource(url=p.url, title=p.title[:300], excerpt=_window(p, n)[:EXCERPT]) for p, n in self.order]


def check_row(row: ResearchRow, said: dict[str, Any], pages: list[Page], cites: _Cites) -> ResearchedRow:
    """What the reader said about one contact, kept only where a page shows it."""
    out = ResearchedRow(id=row.id)
    why: list[str] = []
    domain = _clean(row.domain).lower()

    name = row.name.strip()
    said_name = _clean(str(said.get("name") or ""))[:200]
    if not name and said_name:
        page = _showing(pages, said_name, _page(pages, said.get("name_page")))
        if page:
            out.name, out.src_name, name = said_name, cites.cite(page, said_name), said_name
    said_role = _clean(str(said.get("role") or ""))[:200]
    if not row.role.strip() and said_role and name:
        page = _showing(pages, said_role, _page(pages, said.get("role_page")), _role_on_page)
        if page:
            out.role, out.src_role = said_role, cites.cite(page, said_role)

    if not row.email.strip():
        said_email = _clean(str(said.get("email") or "")).lower().strip(".")
        page = _showing(pages, said_email, _page(pages, said.get("email_page"))) if _EMAIL.fullmatch(said_email or "-") else None
        if page:
            out.email, out.email_status, out.src_email = said_email, "verified", cites.cite(page, said_email)
        elif name and domain:
            # A colleague's address a page shows, with their name: the pattern, applied by code.
            for owner in said.get("owners") or []:
                if not isinstance(owner, dict):
                    continue
                address = _clean(str(owner.get("email") or "")).lower()
                if not address.endswith("@" + domain):
                    continue
                shown = _showing(pages, address, _page(pages, owner.get("page")))
                pattern = pattern_of(address, str(owner.get("name") or "")) if shown else ""
                guess = apply_pattern(pattern, name, domain) if pattern else ""
                if guess:
                    seen = _showing(pages, guess, None)
                    if seen:  # the guess is itself on a page: it is not a guess
                        out.email, out.email_status, out.src_email = guess, "verified", cites.cite(seen, guess)
                    else:
                        cite = cites.cite(shown, address)
                        out.email, out.email_status, out.src_email = guess, "guess", cite
                        out.guessed_from = f"{address} {cite}"
                    break
        if not out.email:
            out.email_status = "none"
            why.append("No page found shows an address for them." if name else "No page found names a person or shows an address.")

    if not row.detail.strip():
        said_detail = _clean(str(said.get("detail") or ""))[:600]
        page = _page(pages, said.get("detail_page"))
        if said_detail and _grounded(said_detail, page):
            line = _sentence(str(said.get("personal_line") or ""))
            out.detail, out.src_detail = said_detail, cites.cite(page, _words(said_detail)[0] if _words(said_detail) else "")
            out.personal_line = line

    for c in (said.get("candidates") or [])[:2]:
        if not isinstance(c, dict):
            continue
        cname = _clean(str(c.get("name") or ""))[:200]
        page = _showing(pages, cname, _page(pages, c.get("page"))) if cname else None
        cwhy = _clean(str(c.get("why") or ""))[:300]
        if not page or not cwhy:
            continue
        cemail = _clean(str(c.get("email") or "")).lower()
        if cemail and not _showing(pages, cemail, None):
            cemail = ""
        out.candidates.append(Candidate(name=cname, role=_clean(str(c.get("role") or ""))[:200], email=cemail, why=cwhy, source=cites.cite(page, cname)))

    not_found = _sentence(str(said.get("not_found") or ""), 300)
    if not_found and (not out.email and not row.email.strip() or not name):
        why.append(not_found)
    out.reason = " ".join(dict.fromkeys(why))[:500]
    return out


async def research(
    client: OpenRouterClient, inputs: PMInput, brief: str, rows: list[ResearchRow]
) -> tuple[list[ResearchedRow], list[WebSource], list[str], dict[str, int]]:
    """Search, read and check up to five contacts. Returns the rows, the sources they cite, the queries and usage."""
    rows = rows[:MAX_ROWS]
    queries = {row.id: queries_for(row) for row in rows}
    flat = [(row.id, q) for row in rows for q in queries[row.id]]
    results = await asyncio.gather(*(search_pages(client, q) for _id, q in flat))
    pages: dict[str, list[Page]] = {row.id: [] for row in rows}
    for (row_id, _q), found in zip(flat, results):
        have = {p.url for p in pages[row_id]}
        pages[row_id].extend(p for p in found if p.url not in have)
    for row_id in pages:
        pages[row_id] = pages[row_id][:8]

    usage: dict[str, int] = {}
    said_by_id: dict[str, dict[str, Any]] = {}
    if any(pages.values()):
        data, usage = await client.generate_json(build_read_prompt(inputs, brief, rows, pages), system=READ_SYSTEM, temperature=0.1, max_tokens=4_000, model=READ_MODEL)
        for item in (data.get("rows") if isinstance(data, dict) else None) or []:
            if isinstance(item, dict) and str(item.get("id") or "") in pages:
                said_by_id[str(item["id"])] = item

    cites = _Cites(highest_source_number(inputs.sources))
    out = [check_row(row, said_by_id.get(row.id, {}), pages[row.id], cites) for row in rows]
    for row, done in zip(rows, out):
        if not pages[row.id] and not done.reason:
            done.reason = "The search returned nothing for this company."
    return out, cites.sources(), [q for _id, q in flat], usage
