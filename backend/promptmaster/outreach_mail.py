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


# ---------------------------------------------------------------------------
# Sending, through the person's own Gmail (Sean, 26 Nov: "If a send times out, check the mailbox
# before retrying so the person doesn't get two copies"). Draft, then send the draft: a draft that
# was sent no longer exists, so sending it again cannot send twice, and its id is something to
# look for. Composio documents every result only as `data`, so ids are read by key.
# ---------------------------------------------------------------------------


class SendError(Exception):
    """A send that failed. `uncertain`: it may have reached Gmail, so Sent is searched before any retry."""

    def __init__(self, message: str, uncertain: bool) -> None:
        super().__init__(message)
        self.uncertain = uncertain


@dataclass(frozen=True)
class Sent:
    message_id: str
    thread_id: str
    thread_url: str


def _gmail_args(snapshot: dict[str, Any]) -> dict[str, Any]:
    to = list(snapshot.get("to") or [])
    return {
        "user_id": "me",
        "recipient_email": to[0] if to else "",
        **({"extra_recipients": to[1:]} if len(to) > 1 else {}),
        **({"cc": list(snapshot["cc"])} if snapshot.get("cc") else {}),
        **({"bcc": list(snapshot["bcc"])} if snapshot.get("bcc") else {}),
        "subject": str(snapshot.get("subject") or ""),
        "body": str(snapshot.get("html") or ""),
        "is_html": True,
        # Gmail's own signature would sit under ours: "check … whether the signature appears twice".
        "include_signature": False,
    }


def _composio_error(e: ComposioError) -> SendError:
    # A refusal before Gmail accepted anything (bad request, expired grant) is certain: it did not go.
    certain = e.status is not None and 400 <= e.status < 500
    return SendError(str(e)[:300], uncertain=not certain)


async def create_draft(c: Composio, user_id: str, snapshot: dict[str, Any]) -> str:
    session = await c.create_session(user_id, ["gmail"])
    try:
        data = await c.execute(session, "GMAIL_CREATE_EMAIL_DRAFT", _gmail_args(snapshot))
    except ComposioError as e:
        raise _composio_error(e) from e
    # The draft resource is {id, message: {id, threadId}}: the draft's own id is the shallowest `id`.
    draft_id = str(find_key(data, ("draft_id", "draftId")) or find_key(data, ("id",)) or "")
    if not draft_id:
        logger.warning("OUTREACH_DRAFT_NO_ID keys=%s", list(data)[:10] if isinstance(data, dict) else type(data).__name__)
        raise SendError("Gmail made the draft but did not say its id.", uncertain=False)
    return draft_id


async def send_draft(c: Composio, user_id: str, draft_id: str, mailbox: str) -> Sent:
    session = await c.create_session(user_id, ["gmail"])
    try:
        data = await c.execute(session, "GMAIL_SEND_DRAFT", {"user_id": "me", "draft_id": draft_id})
    except ComposioError as e:
        raise _composio_error(e) from e
    thread = str(find_key(data, ("threadId", "thread_id")) or "")
    message = str(find_key(data, ("messageId", "message_id")) or find_key(data, ("id",)) or "")
    if not message:
        logger.warning("OUTREACH_SEND_NO_ID keys=%s", list(data)[:10] if isinstance(data, dict) else type(data).__name__)
        raise SendError("Gmail did not say what it sent.", uncertain=True)
    return Sent(message_id=message, thread_id=thread, thread_url=gmail_thread_url(thread, mailbox))


def _quoted(text: str) -> str:
    return '"' + re.sub(r'["\\]', " ", text)[:150] + '"'


async def find_sent(c: Composio, user_id: str, snapshot: dict[str, Any], after_epoch: int, mailbox: str) -> Sent | None:
    """This email in Sent, if it went: the same recipient and subject, since the send began."""
    to = [str(a).lower() for a in (snapshot.get("to") or [])]
    if not to:
        return None
    query = f"in:sent to:{to[0]} subject:{_quoted(str(snapshot.get('subject') or ''))} after:{max(0, after_epoch - 60)}"
    session = await c.create_session(user_id, ["gmail"])
    try:
        data = await c.execute(session, "GMAIL_FETCH_EMAILS", {"user_id": "me", "query": query, "max_results": 5, "verbose": False, "include_payload": False})
    except ComposioError as e:
        raise _composio_error(e) from e
    for r in find_records(data, ("messageId", "message_id", "id")):
        if to[0] in _recipients(r):
            mid = str(_first(r, "messageId", "message_id", "id") or "")
            thread = str(_first(r, "threadId", "thread_id") or "")
            if mid:
                return Sent(message_id=mid, thread_id=thread, thread_url=gmail_thread_url(thread, mailbox))
    return None


@dataclass(frozen=True)
class Confirmed:
    sent: bool
    thread_id: str
    thread_url: str
    #: The copy in Sent has the approved subject and recipient.
    matches: bool


async def confirm_sent(c: Composio, user_id: str, message_id: str, snapshot: dict[str, Any], mailbox: str) -> Confirmed:
    session = await c.create_session(user_id, ["gmail"])
    try:
        data = await c.execute(session, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {"user_id": "me", "message_id": message_id, "format": "metadata"})
    except ComposioError as e:
        raise _composio_error(e) from e
    labels = find_key(data, ("labelIds", "label_ids")) or []
    thread = str(find_key(data, ("threadId", "thread_id")) or "")
    record = data if isinstance(data, dict) else {}
    subject = str(_first(record, "subject", "preview.subject") or _header(record, "Subject") or find_key(data, ("subject",)) or "")
    to = [str(a).lower() for a in (snapshot.get("to") or [])]
    matches = bool(to) and to[0] in _recipients(record) and subject.strip() == str(snapshot.get("subject") or "").strip()
    return Confirmed(sent=isinstance(labels, list) and "SENT" in labels, thread_id=thread, thread_url=gmail_thread_url(thread, mailbox), matches=matches)


def _html_of(data: Any) -> str:
    """The HTML part of a full Gmail message, decoded; '' when there is none."""
    import base64

    parts: list[Any] = []
    payload = find_key(data, ("payload",))
    stack = [payload] if payload else []
    while stack:
        p = stack.pop()
        if isinstance(p, dict):
            if str(p.get("mimeType", "")).lower() == "text/html":
                body = (p.get("body") or {}).get("data") if isinstance(p.get("body"), dict) else None
                if body:
                    parts.append(body)
            stack.extend(p.get("parts") or [])
    for raw in parts:
        try:
            return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8", errors="replace")
        except (ValueError, TypeError):
            continue
    text = find_key(data, ("messageText", "message_text"))
    return text if isinstance(text, str) else ""


async def received_html(c: Composio, user_id: str, message_id: str) -> str:
    """A test email as it arrived in the person's own inbox (sent to themselves, it is the same message)."""
    session = await c.create_session(user_id, ["gmail"])
    try:
        data = await c.execute(session, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {"user_id": "me", "message_id": message_id, "format": "full"})
    except ComposioError as e:
        raise _composio_error(e) from e
    return _html_of(data)
