"""Reading a person's own mail, calendar and files, through Composio (7 Nov).

Two steps, so nothing reaches a model that the person did not pick:

1. **Preview** lists what is there: senders, subjects, dates, meeting titles,
   file names. No body, no description, no file text.
2. **Read** fetches the full text of the items the person ticked, cleans it
   (hidden HTML, invisible characters and links removed) and caps it. The
   browser shows that exact text before it is used anywhere.

Composio documents every tool's output as an opaque `data` object, so the
parsers below accept both Composio's own field names and the provider's native
ones (Gmail API, Google Calendar, Drive, Microsoft Graph). When a result parses
to nothing, the field *names* are logged, never their values, so a changed shape
can be seen without anyone's mail landing in the logs.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import html
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, field_validator

from promptmaster.composio_client import Composio, ComposioError

logger = logging.getLogger(__name__)

Kind = Literal["email", "calendar_event", "file"]

# Composio toolkit slugs. Yahoo is not one Composio offers.
GMAIL = "gmail"
GOOGLE_CALENDAR = "googlecalendar"
GOOGLE_DRIVE = "googledrive"
OUTLOOK = "outlook"
ONE_DRIVE = "one_drive"


@dataclass(frozen=True)
class Toolkit:
    slug: str
    label: str
    reads: str


TOOLKITS: dict[str, Toolkit] = {
    GMAIL: Toolkit(GMAIL, "Gmail", "Sender, subject and date of the last 14 days of mail; the full text of an email only when you tick it."),
    GOOGLE_CALENDAR: Toolkit(GOOGLE_CALENDAR, "Google Calendar", "Your meetings for the next 14 days; a meeting's description only when you tick it."),
    GOOGLE_DRIVE: Toolkit(GOOGLE_DRIVE, "Google Drive", "The names of your 20 most recently changed files; a file's text only when you tick it."),
    OUTLOOK: Toolkit(OUTLOOK, "Outlook", "Sender, subject and date of the last 14 days of mail and your meetings for the next 14 days; full text only when you tick it."),
    ONE_DRIVE: Toolkit(ONE_DRIVE, "OneDrive", "The names of your 20 most recent files; a file's text only when you tick it."),
}

DAYS = 14
MAX_EMAILS = 30
MAX_EVENTS = 25
MAX_FILES = 20
MAX_PICKED = 20
MAX_TEXT_CHARS = 8_000
MAX_ATTENDEES = 20
# Office files and PDFs go back to the browser, which already reads them
# (lib/data/extract-text.ts). Vercel caps a response at 4.5 MB.
MAX_FILE_BYTES = 2_500_000
MAX_FILES_BYTES = 3_000_000

GOOGLE_DOC = "application/vnd.google-apps.document"
GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet"
GOOGLE_SLIDES = "application/vnd.google-apps.presentation"
EXPORT_AS = {GOOGLE_DOC: "text/plain", GOOGLE_SHEET: "text/csv", GOOGLE_SLIDES: "text/plain"}
TEXT_TYPES = ("text/", "application/json", "application/xml")
BROWSER_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
_EXT_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
}
NOT_READABLE = "This kind of file can't be read here yet. Download it and attach it instead."


# ---------------------------------------------------------------------------
# What goes over the wire.
# ---------------------------------------------------------------------------


class PreviewItem(BaseModel):
    """One thing in someone's account, described without its contents."""

    id: str
    toolkit: str
    kind: Kind
    title: str
    when: str = ""
    who: str = ""
    people: list[str] = Field(default_factory=list)
    detail: str = ""
    ref: dict[str, str] = Field(default_factory=dict)
    readable: bool = True
    note: str = ""


class PickedItem(BaseModel):
    """An item the person ticked, sent back to be read."""

    id: str = Field(min_length=1, max_length=300)
    toolkit: str = Field(max_length=40)
    kind: Kind
    title: str = Field(default="", max_length=300)
    ref: dict[str, str] = Field(default_factory=dict, max_length=6)

    @field_validator("ref")
    @classmethod
    def _short_ref(cls, ref: dict[str, str]) -> dict[str, str]:
        return {k[:40]: v[:300] for k, v in ref.items()}


class ConnectedText(BaseModel):
    """The text of one ticked item. The same shape as `ThirdPartyItem`."""

    id: str
    toolkit: str
    kind: Kind
    source: str
    title: str
    text: str


class ConnectedFile(BaseModel):
    """A PDF or Office file, handed to the browser to turn into text."""

    id: str
    toolkit: str
    source: str
    title: str
    mime: str
    data_base64: str


class Skipped(BaseModel):
    id: str
    title: str = ""
    reason: str


class Problem(BaseModel):
    toolkit: str
    message: str


# ---------------------------------------------------------------------------
# Cleaning.
# ---------------------------------------------------------------------------

_INVISIBLE = re.compile("[­​-‏‪-‮⁠-⁤⁦-⁩﻿]")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_URL = re.compile(r"(?:\b(?:https?|ftp)://|\bwww\.)[^\s<>\"')\]]+", re.IGNORECASE)
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_HIDDEN_STYLE = r"(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em)?\s*(?:;|\")|opacity\s*:\s*0(?:\.0+)?\s*(?:;|\"))"
_HIDDEN_ELEMENT = re.compile(
    r"<(\w+)\b[^>]*style\s*=\s*\"[^\"]*" + _HIDDEN_STYLE + r"[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_DROP_BLOCKS = re.compile(r"<(script|style|head|title|template|noscript)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_COMMENTS = re.compile(r"<!--.*?-->", re.DOTALL)
_BREAKS = re.compile(r"<(?:br|/p|/div|/li|/tr|/h[1-6]|/blockquote|/table)\b[^>]*>", re.IGNORECASE)
_TAGS = re.compile(r"<[^>]+>")
# A tag name followed by space, '>' or '/': "<a href" is HTML, "<a@b.example>" is an address.
_LOOKS_HTML = re.compile(r"<(?:html|body|div|p|br|table|span|a)(?=[\s>/])", re.IGNORECASE)
_CUT = "\n[…cut here: the rest was longer than this allows]"


def html_to_text(raw: str) -> str:
    """Visible text only. Text hidden by style is what an injection hides in, so it goes first."""
    text = _COMMENTS.sub(" ", raw)
    text = _DROP_BLOCKS.sub(" ", text)
    # Repeat: a hidden element can hold another hidden element.
    for _ in range(3):
        stripped = _HIDDEN_ELEMENT.sub(" ", text)
        if stripped == text:
            break
        text = stripped
    text = _BREAKS.sub("\n", text)
    text = _TAGS.sub(" ", text)
    return html.unescape(text)


def clean_text(raw: str, limit: int = MAX_TEXT_CHARS) -> str:
    """Plain, visible, link-free text, cut at `limit` and saying so."""
    if not raw:
        return ""
    text = html_to_text(raw) if _LOOKS_HTML.search(raw) else raw
    text = unicodedata.normalize("NFC", text)
    text = _INVISIBLE.sub("", text)
    text = _CONTROL.sub(" ", text)
    text = _MD_IMAGE.sub("[image removed]", text)
    text = _URL.sub("[link removed]", text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > limit:
        text = text[: limit - len(_CUT)].rstrip() + _CUT
    return text


def _short(value: Any, limit: int = 300) -> str:
    """A title, name or place: cleaned, on one line, cut with an ellipsis."""
    if not value:
        return ""
    text = " ".join(clean_text(str(value), MAX_TEXT_CHARS).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# ---------------------------------------------------------------------------
# Finding records in whatever shape came back.
# ---------------------------------------------------------------------------

_SAFE_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_.:-]{0,40}$")


def shape(data: Any, depth: int = 3) -> Any:
    """Field names and types only, for the log. A key that isn't a plain name is not printed."""
    if depth == 0:
        return type(data).__name__
    if isinstance(data, dict):
        return {(k if isinstance(k, str) and _SAFE_KEY.match(k) and "@" not in k else "?"): shape(v, depth - 1) for k, v in list(data.items())[:25]}
    if isinstance(data, list):
        return [len(data), shape(data[0], depth - 1)] if data else [0]
    return type(data).__name__


def find_records(data: Any, id_keys: tuple[str, ...], depth: int = 4) -> list[dict[str, Any]]:
    """The first list of objects that carry one of `id_keys`, searched breadth first."""
    frontier = [data]
    for _ in range(depth + 1):
        nxt: list[Any] = []
        for node in frontier:
            if isinstance(node, list):
                dicts = [x for x in node if isinstance(x, dict)]
                if dicts and any(any(k in d for k in id_keys) for d in dicts):
                    return [d for d in dicts if any(k in d for k in id_keys)]
                nxt.extend(x for x in node if isinstance(x, (dict, list)))
            elif isinstance(node, dict):
                nxt.extend(v for v in node.values() if isinstance(v, (dict, list)))
        frontier = nxt
    return []


def find_object(data: Any, id_keys: tuple[str, ...], depth: int = 3) -> dict[str, Any] | None:
    """The first object that carries one of `id_keys`: the record itself, or one level in."""
    frontier = [data]
    for _ in range(depth + 1):
        nxt: list[Any] = []
        for node in frontier:
            if isinstance(node, dict):
                if any(k in node for k in id_keys):
                    return node
                nxt.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                nxt.extend(x for x in node if isinstance(x, (dict, list)))
        frontier = nxt
    return None


def _first(record: dict[str, Any], *paths: str) -> Any:
    """The first non-empty value among dotted `paths`."""
    for path in paths:
        node: Any = record
        for part in path.split("."):
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                break
        if node not in (None, "", [], {}):
            return node
    return None


def _header(record: dict[str, Any], name: str) -> str:
    headers = _first(record, "payload.headers", "headers")
    if isinstance(headers, list):
        for h in headers:
            if isinstance(h, dict) and str(h.get("name", "")).lower() == name.lower():
                return str(h.get("value") or "")
    elif isinstance(headers, dict):
        for key, value in headers.items():
            if str(key).lower() == name.lower():
                return str(value or "")
    return ""


def _when(value: Any) -> str:
    """An ISO date-time, whatever the provider sent (Gmail's internalDate is milliseconds)."""
    if value in (None, ""):
        return ""
    if isinstance(value, dict):
        value = value.get("dateTime") or value.get("date") or ""
    text = str(value).strip()
    if text.isdigit() and len(text) >= 12:
        return datetime.fromtimestamp(int(text) / 1000, tz=timezone.utc).isoformat(timespec="minutes")
    return text[:40]


def human_when(value: str) -> str:
    """'5 Nov 2026, 15:00 UTC+00:00' for text a person and a model read. Keeps the sender's own offset;
    anything that isn't a date is left as it came."""
    text = (value or "").strip()
    if not text:
        return ""
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            day = datetime.strptime(text, "%Y-%m-%d")
            return f"{day.day} {day:%b %Y}"
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            moment = parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError):
            return text
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    offset = moment.strftime("%z")
    return f"{moment.day} {moment:%b %Y, %H:%M} UTC{offset[:3]}:{offset[3:]}"


def _person(value: Any) -> str:
    """'Name <address>' from a string, a Graph `emailAddress` or a Google person."""
    if isinstance(value, dict):
        inner = value.get("emailAddress") if isinstance(value.get("emailAddress"), dict) else value
        name = str(inner.get("name") or inner.get("displayName") or "").strip()
        address = str(inner.get("address") or inner.get("email") or inner.get("emailAddress") or "").strip()
        if name and address and name != address:
            return f"{name} <{address}>"
        return name or address
    return str(value or "").strip()


def _people(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    out = []
    for v in values[:MAX_ATTENDEES]:
        p = _person(v)
        if p:
            out.append(_short(p, 200))
    return out


def _log_empty(tool: str, data: Any) -> None:
    if data:
        logger.warning("CONNECTIONS_SHAPE tool=%s shape=%s", tool, shape(data))


# ---------------------------------------------------------------------------
# Previews: one per toolkit.
# ---------------------------------------------------------------------------


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def gmail_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("messageId", "message_id", "id"))[:MAX_EMAILS]:
        mid = str(_first(r, "messageId", "message_id", "id") or "")
        if not mid:
            continue
        subject = _first(r, "subject", "preview.subject") or _header(r, "Subject") or "(no subject)"
        sender = _first(r, "sender", "from") or _header(r, "From")
        when = _first(r, "messageTimestamp", "message_timestamp", "date", "internalDate") or _header(r, "Date")
        to = _first(r, "to") or _header(r, "To")
        out.append(PreviewItem(
            id=mid, toolkit=GMAIL, kind="email", title=_short(subject), who=_short(_person(sender)),
            when=_when(when), people=[_short(p, 200) for p in str(to or "").split(",") if p.strip()][:MAX_ATTENDEES],
        ))
    return out


def google_event_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id", "event_id", "eventId"))[:MAX_EVENTS]:
        eid = str(_first(r, "id", "event_id", "eventId") or "")
        if not eid or r.get("status") == "cancelled":
            continue
        out.append(PreviewItem(
            id=eid, toolkit=GOOGLE_CALENDAR, kind="calendar_event",
            title=_short(_first(r, "summary", "title") or "(untitled meeting)"),
            when=_when(_first(r, "start", "start_time", "startTime")),
            who=_short(_person(_first(r, "organizer", "organizer_email"))),
            people=_people(_first(r, "attendees")),
            detail=_short(_first(r, "location"), 200),
        ))
    return out


def _file_mime(record: dict[str, Any]) -> str:
    mime = str(_first(record, "mimeType", "mime_type", "file.mimeType") or "").lower()
    if not mime:
        name = str(_first(record, "name") or "").lower()
        for ext, guessed in _EXT_TYPES.items():
            if name.endswith(ext):
                return guessed
    return mime


def _readable(mime: str) -> bool:
    return mime in EXPORT_AS or mime in BROWSER_TYPES or mime.startswith(TEXT_TYPES)


def drive_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id",))[:MAX_FILES]:
        fid = str(r.get("id") or "")
        mime = _file_mime(r)
        if not fid or mime == "application/vnd.google-apps.folder":
            continue
        readable = _readable(mime)
        owners = r.get("owners")
        out.append(PreviewItem(
            id=fid, toolkit=GOOGLE_DRIVE, kind="file", title=_short(_first(r, "name", "title") or "(untitled file)"),
            when=_when(_first(r, "modifiedTime", "modified_time")),
            who=_short(_person(owners[0])) if isinstance(owners, list) and owners else "",
            detail=mime, ref={"mime": mime}, readable=readable, note="" if readable else NOT_READABLE,
        ))
    return out


def outlook_mail_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id",))[:MAX_EMAILS]:
        mid = str(r.get("id") or "")
        if not mid:
            continue
        out.append(PreviewItem(
            id=mid, toolkit=OUTLOOK, kind="email", title=_short(_first(r, "subject") or "(no subject)"),
            who=_short(_person(_first(r, "from", "sender"))), when=_when(_first(r, "receivedDateTime", "sentDateTime")),
            people=_people(_first(r, "toRecipients")),
        ))
    return out


def outlook_event_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id",))[:MAX_EVENTS]:
        eid = str(r.get("id") or "")
        if not eid or r.get("isCancelled"):
            continue
        start = _when(_first(r, "start"))
        out.append(PreviewItem(
            id=eid, toolkit=OUTLOOK, kind="calendar_event", title=_short(_first(r, "subject") or "(untitled meeting)"),
            when=start, who=_short(_person(_first(r, "organizer"))), people=_people(_first(r, "attendees")),
            detail=_short(_first(r, "location.displayName", "location"), 200), ref={"start": start},
        ))
    return out


def onedrive_items(data: Any) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id",))[:MAX_FILES]:
        remote = r.get("remoteItem") if isinstance(r.get("remoteItem"), dict) else {}
        if "folder" in r or "folder" in remote:
            continue
        fid = str(remote.get("id") or r.get("id") or "")
        if not fid:
            continue
        name = str(_first(r, "name") or "(untitled file)")
        mime = _file_mime(r) or _file_mime(remote)
        drive_id = str(_first(remote, "parentReference.driveId") or _first(r, "parentReference.driveId") or "")
        readable = _readable(mime)
        ref = {"mime": mime, "name": name[:200]}
        if drive_id:
            ref["drive_id"] = drive_id
        out.append(PreviewItem(
            id=fid, toolkit=ONE_DRIVE, kind="file", title=_short(name),
            when=_when(_first(r, "lastModifiedDateTime")), detail=mime, ref=ref,
            readable=readable, note="" if readable else NOT_READABLE,
        ))
    return out


async def _gmail_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GMAIL_FETCH_EMAILS"
    data = await c.execute(sid, tool, {
        "user_id": "me", "query": f"newer_than:{DAYS}d -in:chats", "max_results": MAX_EMAILS,
        "verbose": False, "include_payload": False,
    })
    items = gmail_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _google_calendar_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GOOGLECALENDAR_EVENTS_LIST"
    data = await c.execute(sid, tool, {
        "calendarId": "primary", "timeMin": _iso(now), "timeMax": _iso(now + timedelta(days=DAYS)),
        "singleEvents": True, "orderBy": "startTime", "maxResults": MAX_EVENTS,
    })
    items = google_event_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _drive_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GOOGLEDRIVE_FIND_FILE"
    data = await c.execute(sid, tool, {
        "q": "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
        "orderBy": "modifiedTime desc", "pageSize": MAX_FILES, "corpora": "user",
        "fields": "files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress))",
    })
    items = drive_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _outlook_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    mail_tool, event_tool = "OUTLOOK_LIST_MESSAGES", "OUTLOOK_GET_CALENDAR_VIEW"
    mail, events = await asyncio.gather(
        c.execute(sid, mail_tool, {
            "top": MAX_EMAILS, "select": ["id", "subject", "from", "toRecipients", "receivedDateTime"],
            "received_date_time_ge": _iso(now - timedelta(days=DAYS)), "orderby": ["receivedDateTime desc"],
        }),
        c.execute(sid, event_tool, {
            "start_datetime": _iso(now), "end_datetime": _iso(now + timedelta(days=DAYS)), "top": MAX_EVENTS,
            "select": ["id", "subject", "start", "end", "organizer", "attendees", "location", "isCancelled"],
            "orderby": "start/dateTime asc",
        }),
        return_exceptions=True,
    )
    items: list[PreviewItem] = []
    for tool, data, parse in ((mail_tool, mail, outlook_mail_items), (event_tool, events, outlook_event_items)):
        if isinstance(data, BaseException):
            if not isinstance(data, ComposioError):
                raise data
            logger.warning("CONNECTIONS_TOOL_FAILED tool=%s error=%s", tool, data)
            continue
        found = parse(data)
        if not found:
            _log_empty(tool, data)
        items.extend(found)
    if isinstance(mail, ComposioError) and isinstance(events, ComposioError):
        raise mail
    return items


async def _onedrive_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "ONE_DRIVE_GET_RECENT_ITEMS"
    try:
        data = await c.execute(sid, tool, {"top": MAX_FILES, "select": "id,name,lastModifiedDateTime,file,folder,size,parentReference,remoteItem"})
    except ComposioError:
        # Graph's "recent" endpoint is deprecated; the drive's top level is the fallback.
        tool = "ONE_DRIVE_ONEDRIVE_LIST_ITEMS"
        data = await c.execute(sid, tool, {"top": MAX_FILES})
    items = onedrive_items(data)
    if not items:
        _log_empty(tool, data)
    return items


PREVIEWS = {
    GMAIL: _gmail_preview,
    GOOGLE_CALENDAR: _google_calendar_preview,
    GOOGLE_DRIVE: _drive_preview,
    OUTLOOK: _outlook_preview,
    ONE_DRIVE: _onedrive_preview,
}


def ordered(items: list[PreviewItem]) -> list[PreviewItem]:
    """Meetings soonest first, then mail and files newest first."""
    meetings = sorted((i for i in items if i.kind == "calendar_event"), key=lambda i: i.when)
    mail = sorted((i for i in items if i.kind == "email"), key=lambda i: i.when, reverse=True)
    files = sorted((i for i in items if i.kind == "file"), key=lambda i: i.when, reverse=True)
    return meetings + mail + files


async def preview(c: Composio, user_id: str, toolkits: list[str], now: datetime | None = None) -> tuple[list[PreviewItem], list[Problem]]:
    """What is in each connected account, without its contents. One toolkit failing doesn't stop the others."""
    now = now or datetime.now(timezone.utc)
    wanted = [t for t in toolkits if t in PREVIEWS]
    if not wanted:
        return [], []
    session = await c.create_session(user_id, wanted)
    results = await asyncio.gather(*(PREVIEWS[t](c, session, now) for t in wanted), return_exceptions=True)
    items: list[PreviewItem] = []
    problems: list[Problem] = []
    for toolkit, result in zip(wanted, results):
        if isinstance(result, ComposioError):
            logger.warning("CONNECTIONS_PREVIEW_FAILED toolkit=%s error=%s", toolkit, result)
            problems.append(Problem(toolkit=toolkit, message=f"{TOOLKITS[toolkit].label} could not be read just now. Try again, or reconnect it."))
        elif isinstance(result, BaseException):
            raise result
        else:
            items.extend(result)
    return ordered(items), problems


# ---------------------------------------------------------------------------
# Reading what was ticked.
# ---------------------------------------------------------------------------


def _decode_b64(data: str) -> bytes:
    padded = data.replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    return base64.b64decode(padded)


def _gmail_body(record: dict[str, Any]) -> str:
    """The message text: Composio's `messageText` when present, else the MIME parts, plain preferred."""
    direct = _first(record, "messageText", "message_text", "text", "body", "preview.body", "snippet")
    if isinstance(direct, str) and direct.strip():
        return direct
    plain: list[str] = []
    rich: list[str] = []

    def walk(part: Any) -> None:
        if not isinstance(part, dict):
            return
        mime = str(part.get("mimeType") or "").lower()
        body = part.get("body") if isinstance(part.get("body"), dict) else {}
        raw = body.get("data")
        if raw and mime in ("text/plain", "text/html"):
            try:
                text = _decode_b64(str(raw)).decode("utf-8", errors="replace")
            except (binascii.Error, ValueError):
                text = ""
            (plain if mime == "text/plain" else rich).append(text)
        for child in part.get("parts") or []:
            walk(child)

    walk(record.get("payload") or record)
    return "\n".join(plain) if plain else "\n".join(rich)


def _source(label: str, *bits: str) -> str:
    return " · ".join([label, *[b for b in bits if b]])[:300]


async def _read_gmail(c: Composio, sid: str, item: PickedItem) -> ConnectedText:
    tool = "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID"
    data = await c.execute(sid, tool, {"user_id": "me", "message_id": item.id, "format": "full"})
    record = find_object(data, ("messageId", "message_id", "payload", "messageText", "id")) or {}
    subject = _first(record, "subject", "preview.subject") or _header(record, "Subject") or item.title
    sender = _person(_first(record, "sender", "from") or _header(record, "From"))
    to = _first(record, "to") or _header(record, "To")
    when = human_when(_when(_first(record, "messageTimestamp", "date", "internalDate") or _header(record, "Date")))
    body = clean_text(_gmail_body(record))
    if not body:
        _log_empty(tool, data)
    head = "\n".join(line for line in (
        f"From: {_short(sender)}" if sender else "",
        f"To: {_short(to)}" if to else "",
        f"Date: {when}" if when else "",
        f"Subject: {_short(subject)}",
    ) if line)
    return ConnectedText(id=item.id, toolkit=GMAIL, kind="email", source=_source("Gmail", _short(sender, 120), when),
                         title=_short(subject), text=clean_text(f"{head}\n\n{body}"))


def _event_text(r: dict[str, Any], fallback_title: str) -> tuple[str, str, str]:
    title = _short(_first(r, "summary", "subject", "title") or fallback_title)
    start = human_when(_when(_first(r, "start", "start_time")))
    end = human_when(_when(_first(r, "end", "end_time")))
    where = _short(_first(r, "location.displayName", "location"), 200)
    organizer = _short(_person(_first(r, "organizer")), 200)
    attendees = ", ".join(_people(_first(r, "attendees")))
    description = _first(r, "description", "body.content", "bodyPreview") or ""
    lines = [f"What: {title}", f"When: {start}{' to ' + end if end else ''}" if start else ""]
    lines += [f"Where: {where}" if where else "", f"Organizer: {organizer}" if organizer else "",
              f"Attendees: {attendees}" if attendees else ""]
    text = "\n".join(line for line in lines if line)
    if description:
        text += "\n\n" + clean_text(str(description))
    return title, start, clean_text(text)


async def _read_google_event(c: Composio, sid: str, item: PickedItem) -> ConnectedText:
    data = await c.execute(sid, "GOOGLECALENDAR_EVENTS_GET", {"event_id": item.id, "calendar_id": "primary"})
    record = find_object(data, ("summary", "start", "id")) or {}
    title, start, text = _event_text(record, item.title)
    return ConnectedText(id=item.id, toolkit=GOOGLE_CALENDAR, kind="calendar_event",
                         source=_source("Google Calendar", start), title=title, text=text)


async def _read_outlook_mail(c: Composio, sid: str, item: PickedItem) -> ConnectedText:
    tool = "OUTLOOK_GET_MESSAGE"
    data = await c.execute(sid, tool, {"message_id": item.id, "select": ["subject", "from", "toRecipients", "receivedDateTime", "body"]})
    r = find_object(data, ("subject", "body", "id")) or {}
    sender = _person(_first(r, "from", "sender"))
    when = human_when(_when(_first(r, "receivedDateTime", "sentDateTime")))
    to = ", ".join(_people(_first(r, "toRecipients")))
    subject = _short(_first(r, "subject") or item.title)
    body = clean_text(str(_first(r, "body.content", "bodyPreview") or ""))
    if not body:
        _log_empty(tool, data)
    head = "\n".join(line for line in (f"From: {_short(sender)}" if sender else "", f"To: {to}" if to else "",
                                       f"Date: {when}" if when else "", f"Subject: {subject}") if line)
    return ConnectedText(id=item.id, toolkit=OUTLOOK, kind="email", source=_source("Outlook", _short(sender, 120), when),
                         title=subject, text=clean_text(f"{head}\n\n{body}"))


async def _read_outlook_event(c: Composio, sid: str, item: PickedItem) -> ConnectedText:
    """Graph has no read-one-event tool in Composio's list, so: that day's view, with bodies, matched by id."""
    try:
        start = datetime.fromisoformat(item.ref.get("start", "").replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
    except ValueError:
        start = datetime.now(timezone.utc)
    data = await c.execute(sid, "OUTLOOK_GET_CALENDAR_VIEW", {
        "start_datetime": _iso(start - timedelta(days=1)), "end_datetime": _iso(start + timedelta(days=1)), "top": 50,
        "select": ["id", "subject", "start", "end", "organizer", "attendees", "location", "body"],
    })
    record = next((r for r in find_records(data, ("id",)) if str(r.get("id")) == item.id), None)
    if record is None:
        raise ComposioError("That meeting is no longer in the calendar.", 404)
    title, when, text = _event_text(record, item.title)
    return ConnectedText(id=item.id, toolkit=OUTLOOK, kind="calendar_event", source=_source("Outlook calendar", when),
                         title=title, text=text)


_FILE_URL_KEYS = ("s3url", "s3_url", "url", "download_url", "downloadUrl", "@microsoft.graph.downloadUrl")
# Where a pre-signed file link may point: Composio's storage, and Microsoft's for OneDrive.
_FILE_HOSTS = ("amazonaws.com", "composio.dev", "r2.cloudflarestorage.com", "sharepoint.com", "1drv.com", "live.com", "microsoft.com")


async def _fetch_url(url: str) -> bytes:
    """A pre-signed download link from Composio or Microsoft. Nothing else is fetched."""
    host = (httpx.URL(url).host or "").lower()
    if not any(host == d or host.endswith("." + d) for d in _FILE_HOSTS):
        raise ComposioError("The file came back from an address this doesn't fetch from.")
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http:
        async with http.stream("GET", url) as response:
            response.raise_for_status()
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise ComposioError("The file is too large to read here. Download it and attach it instead.", 413)
                chunks.append(chunk)
    return b"".join(chunks)


_CONTENT_KEYS = ("downloaded_file_content", "exported_content", "file_content", "content", "file", "text", "base64", "data")


async def file_content(data: Any) -> bytes | str:
    """A file tool's result as bytes (or text), whether inline, base64 or behind a pre-signed link."""
    node: Any = data
    for _ in range(5):
        if isinstance(node, str):
            return await _fetch_url(node) if node.startswith("https://") and " " not in node else node
        if not isinstance(node, dict):
            break
        for key in _FILE_URL_KEYS:
            if isinstance(node.get(key), str) and node[key].startswith("https://"):
                return await _fetch_url(node[key])
        inner = next((node[k] for k in _CONTENT_KEYS if node.get(k) not in (None, "", {}, [])), None)
        if inner is None:
            break
        node = inner
    raise ComposioError("The file's content did not come back.")


def _as_text(content: bytes | str) -> str:
    if isinstance(content, bytes):
        return content.decode("utf-8", errors="replace")
    return content


def _as_bytes(content: bytes | str) -> bytes:
    if isinstance(content, bytes):
        return content
    try:
        return _decode_b64(content.strip())
    except (binascii.Error, ValueError) as e:
        raise ComposioError("The file's content could not be read.") from e


async def _read_file(c: Composio, sid: str, item: PickedItem, toolkit: str) -> ConnectedText | ConnectedFile:
    mime = item.ref.get("mime", "")
    label = TOOLKITS[toolkit].label
    if toolkit == GOOGLE_DRIVE and mime in EXPORT_AS:
        data = await c.execute(sid, "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE", {"fileId": item.id, "mimeType": EXPORT_AS[mime]})
    elif toolkit == GOOGLE_DRIVE:
        data = await c.execute(sid, "GOOGLEDRIVE_DOWNLOAD_FILE", {"fileId": item.id})
    else:
        args = {"item_id": item.id, "file_name": item.ref.get("name") or item.title or "file"}
        if item.ref.get("drive_id"):
            args["drive_id"] = item.ref["drive_id"]
        data = await c.execute(sid, "ONE_DRIVE_DOWNLOAD_FILE", args)
    content = await file_content(data)
    if mime in BROWSER_TYPES:
        raw = _as_bytes(content)
        if len(raw) > MAX_FILE_BYTES:
            raise ComposioError("The file is too large to read here. Download it and attach it instead.", 413)
        return ConnectedFile(id=item.id, toolkit=toolkit, source=_source(label), title=_short(item.title),
                             mime=mime, data_base64=base64.b64encode(raw).decode("ascii"))
    return ConnectedText(id=item.id, toolkit=toolkit, kind="file", source=_source(label), title=_short(item.title),
                         text=clean_text(_as_text(content)))


async def _read_one(c: Composio, sid: str, item: PickedItem) -> ConnectedText | ConnectedFile:
    if item.kind == "email":
        return await (_read_gmail if item.toolkit == GMAIL else _read_outlook_mail)(c, sid, item)
    if item.kind == "calendar_event":
        return await (_read_google_event if item.toolkit == GOOGLE_CALENDAR else _read_outlook_event)(c, sid, item)
    if not _readable(item.ref.get("mime", "")):
        raise ComposioError(NOT_READABLE)
    return await _read_file(c, sid, item, item.toolkit)


_VALID = {(GMAIL, "email"), (OUTLOOK, "email"), (GOOGLE_CALENDAR, "calendar_event"), (OUTLOOK, "calendar_event"),
          (GOOGLE_DRIVE, "file"), (ONE_DRIVE, "file")}


async def read(c: Composio, user_id: str, picked: list[PickedItem]) -> tuple[list[ConnectedText], list[ConnectedFile], list[Skipped]]:
    """The full text of each ticked item. An item that can't be read is listed with the reason, not dropped silently."""
    picked = picked[:MAX_PICKED]
    valid = [p for p in picked if (p.toolkit, p.kind) in _VALID]
    skipped = [Skipped(id=p.id, title=p.title, reason="This isn't something PromptMaster reads.") for p in picked if p not in valid]
    if not valid:
        return [], [], skipped
    session = await c.create_session(user_id, sorted({p.toolkit for p in valid}))
    results = await asyncio.gather(*(_read_one(c, session, p) for p in valid), return_exceptions=True)
    texts: list[ConnectedText] = []
    files: list[ConnectedFile] = []
    budget = MAX_FILES_BYTES
    for item, result in zip(valid, results):
        if isinstance(result, ComposioError):
            logger.warning("CONNECTIONS_READ_FAILED toolkit=%s kind=%s error=%s", item.toolkit, item.kind, result)
            reason = str(result) if result.status in (404, 413) or str(result) == NOT_READABLE else "It could not be read just now."
            skipped.append(Skipped(id=item.id, title=item.title, reason=reason))
        elif isinstance(result, BaseException):
            raise result
        elif isinstance(result, ConnectedFile):
            size = len(result.data_base64) * 3 // 4
            if size > budget:
                skipped.append(Skipped(id=item.id, title=item.title, reason="Together these files are too large to read at once. Pick fewer."))
            else:
                budget -= size
                files.append(result)
        elif not result.text.strip():
            skipped.append(Skipped(id=item.id, title=item.title, reason="There was no text in it to read."))
        else:
            texts.append(result)
    return texts, files, skipped
