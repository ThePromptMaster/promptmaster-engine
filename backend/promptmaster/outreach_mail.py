"""The mailbox outreach email goes out from (Sean, 26 Nov: "Let me connect the mailbox I want to
send from. Start with whichever of Gmail or Outlook gets us there fastest. Show me which account
is connected and let me disconnect it").

Composio holds the connection, keyed by the person's Supabase user id, as it does for reading
(`connections.py`). This module reads which address a connected mailbox sends as. Sending itself
comes with the approval record and the job that sends (later phases); nothing here sends.

Composio documents every tool's output only as `data`, so the address is found by key wherever
it sits in what comes back, rather than at one assumed path.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from .composio_client import Composio, ComposioError
from .connections import _first, _header, _when, find_records

logger = logging.getLogger(__name__)

#: The connections that can send email, in the order they are offered.
SENDING_TOOLKITS: tuple[str, ...] = ("gmail", "outlook")

#: Where each mailbox says which address it is (Composio tool, its arguments, the keys to look for).
_PROFILE: dict[str, tuple[str, dict[str, Any], tuple[str, ...]]] = {
    "gmail": ("GMAIL_GET_PROFILE", {"user_id": "me"}, ("emailAddress", "email_address", "email")),
    "outlook": ("OUTLOOK_GET_PROFILE", {"user_id": "me"}, ("mail", "userPrincipalName", "emailAddress", "email")),
}


@dataclass(frozen=True)
class Mailbox:
    toolkit: str
    address: str


def find_key(data: Any, keys: tuple[str, ...], depth: int = 0) -> Any:
    """The first value under any of `keys`, searched breadth-first through dicts and lists.

    Composio wraps tool results differently from tool to tool ("may be wrapped under a top-level
    data field", its own docs say), so a fixed path would read nothing the day it moves.
    """
    if depth > 6:
        return None
    if isinstance(data, dict):
        for k in keys:
            if k in data and data[k] not in (None, ""):
                return data[k]
        for v in data.values():
            found = find_key(v, keys, depth + 1)
            if found not in (None, ""):
                return found
    elif isinstance(data, list):
        for v in data[:20]:
            found = find_key(v, keys, depth + 1)
            if found not in (None, ""):
                return found
    return None


def _address(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    return text if "@" in text and " " not in text and len(text) <= 320 else None


async def mailbox_address(c: Composio, user_id: str, toolkit: str) -> Mailbox | None:
    """The address a connected mailbox sends as; None when it could not be read."""
    if toolkit not in _PROFILE:
        return None
    tool, arguments, keys = _PROFILE[toolkit]
    try:
        session = await c.create_session(user_id, [toolkit])
        data = await c.execute(session, tool, arguments)
    except ComposioError as e:
        logger.warning("OUTREACH_PROFILE_FAILED toolkit=%s error=%s", toolkit, e)
        return None
    address = _address(find_key(data, keys))
    if address is None:
        logger.warning("OUTREACH_PROFILE_EMPTY toolkit=%s keys=%s", toolkit, list(data)[:10] if isinstance(data, dict) else type(data).__name__)
        return None
    return Mailbox(toolkit=toolkit, address=address)


# ---------------------------------------------------------------------------
# Who the mailbox has already written to (Sean, 26 Nov: "Check the project history and, if I've
# connected the mailbox for that purpose, Sent mail … show when I've reached somebody else at the
# same company"). Read only: the date, the subject and a link to the thread. Never a message's text.
# ---------------------------------------------------------------------------

#: Addresses and domains asked about in one check, and per Gmail search.
MAX_CHECK_ADDRESSES = 50
MAX_CHECK_DOMAINS = 20
_PER_QUERY = 10
_RESULTS_PER_QUERY = 50

_ADDRESS_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


@dataclass(frozen=True)
class SentHit:
    #: The recipient address found in Sent, lower case.
    address: str
    #: ISO date-time of the email, when the mailbox gave one.
    on: str
    subject: str
    thread_url: str


def gmail_thread_url(thread_id: str, mailbox: str = "") -> str:
    """A link that opens the thread in Gmail, in the right account when the address is known."""
    if not thread_id:
        return ""
    who = f"?authuser={quote(mailbox)}" if mailbox else ""
    return f"https://mail.google.com/mail/{who}#all/{quote(thread_id)}"


def _recipients(record: dict[str, Any]) -> list[str]:
    raw = " ".join(str(_first(record, key) or "") for key in ("to", "cc", "bcc")) + " " + " ".join(
        _header(record, h) for h in ("To", "Cc", "Bcc")
    )
    return [a.lower() for a in _ADDRESS_RE.findall(raw)]


def sent_hits(data: Any, mailbox: str = "") -> list[tuple[str, SentHit]]:
    """Every (recipient, email) pair in a Gmail search result."""
    out: list[tuple[str, SentHit]] = []
    for r in find_records(data, ("messageId", "message_id", "id"))[:_RESULTS_PER_QUERY]:
        subject = str(_first(r, "subject", "preview.subject") or _header(r, "Subject") or "")[:300]
        when = _when(_first(r, "messageTimestamp", "message_timestamp", "date", "internalDate") or _header(r, "Date"))
        thread = str(_first(r, "threadId", "thread_id") or "")
        for address in _recipients(r):
            out.append((address, SentHit(address=address, on=when, subject=subject, thread_url=gmail_thread_url(thread, mailbox))))
    return out


def _chunks(items: list[str], n: int) -> list[list[str]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


async def sent_check(
    c: Composio, user_id: str, addresses: list[str], domains: list[str]
) -> tuple[dict[str, SentHit], dict[str, SentHit]]:
    """The latest email in Gmail's Sent to each address, and to anyone at each domain.

    Gmail only for now (Outlook later): returns ({}, {}) when the mailbox cannot be searched.
    Each search names the addresses or domains it looks for, so nothing else is read.
    """
    wanted = sorted({a.strip().lower() for a in addresses if "@" in a})[:MAX_CHECK_ADDRESSES]
    wanted_domains = sorted({d.strip().lower().lstrip("@") for d in domains if "." in d})[:MAX_CHECK_DOMAINS]
    if not wanted and not wanted_domains:
        return {}, {}
    box = await mailbox_address(c, user_id, "gmail")
    mailbox = box.address if box else ""
    session = await c.create_session(user_id, ["gmail"])
    queries = [
        "in:sent to:(" + " OR ".join(chunk) + ")" for chunk in _chunks(wanted, _PER_QUERY)
    ] + ["in:sent to:(" + " OR ".join(f"@{d}" for d in chunk) + ")" for chunk in _chunks(wanted_domains, _PER_QUERY)]
    results = await asyncio.gather(
        *(c.execute(session, "GMAIL_FETCH_EMAILS", {"user_id": "me", "query": q, "max_results": _RESULTS_PER_QUERY, "verbose": False, "include_payload": False}) for q in queries),
        return_exceptions=True,
    )
    by_address: dict[str, SentHit] = {}
    by_domain: dict[str, SentHit] = {}
    for data in results:
        if isinstance(data, BaseException):
            if isinstance(data, ComposioError):
                logger.warning("OUTREACH_SENT_CHECK_FAILED error=%s", data)
                continue
            raise data
        for address, hit in sent_hits(data, mailbox):
            if address in wanted and (address not in by_address or hit.on > by_address[address].on):
                by_address[address] = hit
            domain = address.rsplit("@", 1)[-1]
            if domain in wanted_domains and (domain not in by_domain or hit.on > by_domain[domain].on):
                by_domain[domain] = hit
    return by_address, by_domain
