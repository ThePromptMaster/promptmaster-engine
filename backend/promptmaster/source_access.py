"""What PromptMaster can and cannot read (Sean, 18 Oct, email 7).

A beta user's cookbook depended on an Instagram account's videos. Nothing in
PromptMaster opens a user's link — a brief that rests on a link rests on
nothing — so the intake says so plainly, before any work is built on it.

Since 20–22 Oct a project with Web access on searches the public web
(`web_search`). That is a search, not a link opened: a pasted video or post is
still unread. The rule a prompt carries says which of the two holds (Sean,
22 Oct: a setup written with Web access on said "PromptMaster cannot browse
the web", and every stage was told to rely on pasted text).
"""

import re
from collections.abc import Iterable

LINKS_RULE = (
    "PromptMaster cannot open links, web pages or videos (Instagram, YouTube, TikTok and the "
    "like) — it reads only what the user types, pastes or uploads. When the request depends on "
    "what is behind a link or in a video, say so plainly and ask the user to paste the text "
    "(a transcript, captions, a description) or upload files; never write as if you had seen it."
)

LINKS_RULE_WEB_ON = (
    "PromptMaster can search the public web for this project — current facts, prices, published "
    "pages — and cites what the search finds. It cannot open a particular link the user gives "
    "(a video, a social post, a private page): when the request depends on what is behind one, "
    "say so plainly and ask the user to paste the text or upload files; never write as if you had "
    "seen it. Never say PromptMaster cannot search or browse the web."
)


def links_rule(web_access: str | None) -> str:
    """What PromptMaster can read, as a prompt rule, for the project's Web access."""
    return LINKS_RULE_WEB_ON if web_access == "on" else LINKS_RULE


_ADDRESS = r"(?:(?:https?|ftp)://|www\.|mailto:)[^\s<>\"')\]]+"
_MD_LINK = re.compile(r"!?\[([^\]]*)\]\(\s*<?(" + _ADDRESS + r")>?[^)]*\)", re.IGNORECASE)
_BARE_LINK = re.compile(_ADDRESS, re.IGNORECASE)
LINK_REMOVED = "[link removed]"


def _same(url: str) -> str:
    return url.lower().rstrip("/.,;:")


def addresses_in(texts: Iterable[str]) -> set[str]:
    """Every link in `texts`, as `without_foreign_links` compares them."""
    return {_same(m) for text in texts for m in _BARE_LINK.findall(text or "")}


def without_foreign_links(text: str, allowed: set[str]) -> str:
    """No link in the text unless it is in `allowed` (8 Nov, L-200, L-203).

    A stranger's email can reach the model in a project holding account items, so
    a model talked into writing a link could carry the project's text out in it.
    A link stays only if it is a saved source or came from the person. A Markdown
    link keeps its words.
    """
    if not text:
        return text

    def bare(m: re.Match[str]) -> str:
        url = m.group(0)
        return url if _same(url) in allowed else LINK_REMOVED + url[len(url.rstrip(".,;:!?")):]

    return _BARE_LINK.sub(bare, _MD_LINK.sub(lambda m: m.group(0) if _same(m.group(2)) in allowed else m.group(1), text))
