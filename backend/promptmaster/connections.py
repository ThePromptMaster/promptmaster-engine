"""Reading a person's own mail, calendar, files and CRM records, through Composio (7 Nov; CRM 13 Nov).

Two steps. `account_search` (8 Nov, L-203) decides what goes through them:

1. **Preview** lists what is there: senders, subjects, dates, meeting titles,
   file names. No body, no description, no file text.
2. **Read** fetches the full text of chosen items, cleans it (hidden HTML,
   invisible characters and links removed) and caps it.

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
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Awaitable, Callable, Literal

import httpx
from pydantic import BaseModel, Field, field_validator

from promptmaster.composio_client import Composio, ComposioError

logger = logging.getLogger(__name__)

Kind = Literal["email", "calendar_event", "file", "crm_record"]

# Composio toolkit slugs. Yahoo is not one Composio offers.
GMAIL = "gmail"
GOOGLE_CALENDAR = "googlecalendar"
GOOGLE_DRIVE = "googledrive"
OUTLOOK = "outlook"
ONE_DRIVE = "one_drive"
# 13 Nov (a client: "Can we hook this up to Salesforce? … Hubspot?"). Read only:
# contacts, companies and deals are searched and read, never written.
SALESFORCE = "salesforce"
HUBSPOT = "hubspot"


@dataclass(frozen=True)
class Toolkit:
    slug: str
    label: str
    reads: str


TOOLKITS: dict[str, Toolkit] = {
    GMAIL: Toolkit(GMAIL, "Gmail", "Searches all of your mail and reads the emails that match."),
    GOOGLE_CALENDAR: Toolkit(GOOGLE_CALENDAR, "Google Calendar", "Searches all of your meetings and reads the ones that match."),
    GOOGLE_DRIVE: Toolkit(GOOGLE_DRIVE, "Google Drive", "Searches all of your files and reads the ones that match."),
    OUTLOOK: Toolkit(OUTLOOK, "Outlook", "Searches all of your mail and meetings and reads the ones that match."),
    ONE_DRIVE: Toolkit(ONE_DRIVE, "OneDrive", "Searches all of your files and reads the ones that match."),
    SALESFORCE: Toolkit(SALESFORCE, "Salesforce", "Searches your contacts, accounts and opportunities and reads the ones that match."),
    HUBSPOT: Toolkit(HUBSPOT, "HubSpot", "Searches your contacts, companies and deals and reads the ones that match."),
}

#: Composio's Gmail, Calendar and Drive are one Google app, so revoking one revokes the
#: grant for all three (seen on production, 7 Nov: Drive disconnected, Gmail answered 401).
#: Outlook and OneDrive are one Microsoft app. A CRM is its own grant.
PROVIDER = {
    GMAIL: "google", GOOGLE_CALENDAR: "google", GOOGLE_DRIVE: "google", OUTLOOK: "microsoft", ONE_DRIVE: "microsoft",
    SALESFORCE: "salesforce", HUBSPOT: "hubspot",
}

#: How many of each kind a list or a search brings back. Not how far back it looks.
MAX_EMAILS = 25
MAX_EVENTS = 25
MAX_FILES = 25
#: Of each kind of CRM record (contacts, companies, deals).
MAX_RECORDS = 10
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
    """An item to read, as a preview or a search described it."""

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
    """The text of one item that was read. The same shape as `ThirdPartyItem`."""

    id: str
    toolkit: str
    kind: Kind
    source: str
    title: str
    text: str
    when: str = ""


class ConnectedFile(BaseModel):
    """A PDF or Office file, handed to the browser to turn into text."""

    id: str
    toolkit: str
    source: str
    title: str
    mime: str
    data_base64: str
    when: str = ""


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


def _no_rows(data: Any) -> bool:
    """An answer that is only an empty list, however wrapped: nothing matched, nothing to learn."""
    if isinstance(data, list):
        return not data
    if isinstance(data, dict):
        inner = [v for v in data.values() if isinstance(v, (list, dict))]
        return bool(inner) and all(_no_rows(v) for v in inner)
    return False


def _log_empty(tool: str, data: Any) -> None:
    if data and not _no_rows(data):
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


def google_event_items(data: Any, limit: int = MAX_EVENTS) -> list[PreviewItem]:
    out = []
    for r in find_records(data, ("id", "event_id", "eventId"))[:limit]:
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


# ---------------------------------------------------------------------------
# CRM records (13 Nov): Salesforce and HubSpot. A record is read as a fixed list
# of its fields, never every property: a CRM holds whatever a web form put in it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CrmObject:
    """One kind of record: what the provider calls it, what a person calls it, and the fields read."""

    name: str
    label: str
    #: (what a person calls the field, the provider's field), in the order they are written.
    fields: tuple[tuple[str, str], ...]
    #: The field that holds running text.
    long: str = "Description"
    #: HubSpot only: the Composio tool that searches this kind.
    tool: str = ""


SALESFORCE_OBJECTS: dict[str, CrmObject] = {
    "Contact": CrmObject("Contact", "Contact", (
        ("Title", "Title"), ("Account", "Account.Name"), ("Email", "Email"), ("Phone", "Phone"), ("Department", "Department"),
    )),
    "Account": CrmObject("Account", "Account", (
        ("Industry", "Industry"), ("Type", "Type"), ("Website", "Website"), ("Phone", "Phone"), ("City", "BillingCity"),
        ("Country", "BillingCountry"), ("Annual revenue", "AnnualRevenue"), ("Employees", "NumberOfEmployees"),
    )),
    "Opportunity": CrmObject("Opportunity", "Opportunity", (
        ("Account", "Account.Name"), ("Stage", "StageName"), ("Amount", "Amount"), ("Close date", "CloseDate"),
        ("Probability (%)", "Probability"), ("Type", "Type"), ("Next step", "NextStep"),
    )),
}
HUBSPOT_OBJECTS: dict[str, CrmObject] = {
    "contact": CrmObject("contact", "Contact", (
        ("Job title", "jobtitle"), ("Company", "company"), ("Email", "email"), ("Phone", "phone"), ("Lifecycle stage", "lifecyclestage"),
    ), long="", tool="HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA"),
    "company": CrmObject("company", "Company", (
        ("Domain", "domain"), ("Industry", "industry"), ("City", "city"), ("Country", "country"),
        ("Employees", "numberofemployees"), ("Annual revenue", "annualrevenue"),
    ), long="description", tool="HUBSPOT_SEARCH_COMPANIES"),
    "deal": CrmObject("deal", "Deal", (
        ("Amount", "amount"), ("Stage", "dealstage"), ("Pipeline", "pipeline"), ("Close date", "closedate"), ("Type", "dealtype"),
    ), long="description", tool="HUBSPOT_SEARCH_DEALS"),
}
_HUBSPOT_NAMES = {"contact": ("firstname", "lastname"), "company": ("name",), "deal": ("dealname",)}
_HUBSPOT_MODIFIED = ("lastmodifieddate", "hs_lastmodifieddate")
#: Asked for with a deal and written into its other lines: the currency of the amount, and whether it is open.
_HUBSPOT_ALSO = {"deal": ("deal_currency_code", "hs_is_closed", "hs_is_closed_won")}
#: What an account calls its pipelines and stages. A deal holds only their ids, and in a new account those are numbers.
HUBSPOT_PIPELINES = "HUBSPOT_RETRIEVE_ALL_PIPELINES_FOR_SPECIFIED_OBJECT_TYPE"
#: A Salesforce id is 15 or 18 letters and digits; a HubSpot one is digits. Checked before either goes into a query.
SALESFORCE_ID = re.compile(r"^[A-Za-z0-9]{15,18}$")
HUBSPOT_ID = re.compile(r"^\d{1,20}$")


def salesforce_fields(obj: CrmObject, full: bool = True) -> list[str]:
    """What a query asks for. `full` is everything read; without it, what any profile may see."""
    base = ["Id", "Name", "LastModifiedDate"]
    return base + [f for _label, f in obj.fields] + ([obj.long] if obj.long else []) if full else base


def hubspot_properties(obj: CrmObject) -> list[str]:
    return [*_HUBSPOT_NAMES[obj.name], *(f for _label, f in obj.fields), *([obj.long] if obj.long else []),
            *_HUBSPOT_ALSO.get(obj.name, ()), *_HUBSPOT_MODIFIED]


def crm_id(obj: CrmObject, record_id: str) -> str:
    """An id that says which kind it is: HubSpot numbers contacts, companies and deals apart, so 12 can be all three."""
    return f"{obj.name}:{record_id}"


def split_crm_id(item_id: str, objects: dict[str, CrmObject], valid: re.Pattern[str]) -> tuple[CrmObject, str]:
    name, _, record_id = item_id.partition(":")
    obj = objects.get(name)
    if obj is None or not valid.match(record_id):
        raise ComposioError("That record can't be read.", 404)
    return obj, record_id


def _record_text(obj: CrmObject, title: str, record: dict[str, Any], when: str) -> str:
    """The record as lines a person can read: the fields on the list, then its description."""
    lines = [f"{obj.label}: {title}"]
    for label, path in obj.fields:
        value = _first(record, path)
        if value is not None and not isinstance(value, (dict, list)):
            lines.append(f"{label}: {_short(str(value), 300)}")
    if when:
        lines.append(f"Last changed: {when}")
    text = "\n".join(lines)
    described = _first(record, obj.long) if obj.long else None
    if described:
        text += "\n\n" + clean_text(str(described))
    return clean_text(text)


def _salesforce_type(record: dict[str, Any]) -> str:
    return str(_first(record, "attributes.type") or "")


def salesforce_items(data: Any, default: str = "") -> list[PreviewItem]:
    """Records from a search or a query. Each says its own type; a query of one kind may not."""
    out: list[PreviewItem] = []
    counts: dict[str, int] = {}
    for r in find_records(data, ("Id",)):
        obj = SALESFORCE_OBJECTS.get(_salesforce_type(r) or default)
        rid = str(r.get("Id") or "")
        if obj is None or not SALESFORCE_ID.match(rid) or counts.get(obj.name, 0) >= MAX_RECORDS:
            continue
        counts[obj.name] = counts.get(obj.name, 0) + 1
        out.append(PreviewItem(
            id=crm_id(obj, rid), toolkit=SALESFORCE, kind="crm_record",
            title=_short(_first(r, "Name") or f"({obj.label.lower()} with no name)"),
            when=_when(_first(r, "LastModifiedDate")), who=_short(_first(r, "Account.Name"), 200),
            detail=obj.label, ref={"object": obj.name},
        ))
    return out


def _hubspot_properties(record: dict[str, Any]) -> dict[str, Any]:
    props = record.get("properties")
    return props if isinstance(props, dict) else record


@dataclass(frozen=True)
class DealNames:
    """An account's own names for its pipelines, and for each pipeline's stages."""

    pipelines: dict[str, str] = field(default_factory=dict)
    #: By (pipeline id, stage id), and by ("", stage id) for a deal that does not say its pipeline.
    stages: dict[tuple[str, str], str] = field(default_factory=dict)


def deal_names(data: Any) -> DealNames:
    """The names in HubSpot's list of pipelines, whatever wraps it."""
    pipelines: dict[str, str] = {}
    stages: dict[tuple[str, str], str] = {}
    for p in find_records(data, ("stages",)):
        pid = str(p.get("id") or "")
        if pid and p.get("label"):
            pipelines[pid] = _short(p["label"], 120)
        listed = p.get("stages")
        for stage in listed if isinstance(listed, list) else []:
            if isinstance(stage, dict) and stage.get("id") and stage.get("label"):
                name = _short(stage["label"], 120)
                stages[(pid, str(stage["id"]))] = name
                stages.setdefault(("", str(stage["id"])), name)
    return DealNames(pipelines, stages)


async def hubspot_deal_names(c: Composio, sid: str) -> DealNames:
    """One call for however many deals are read. Without it a deal is still read, with less on its stage line."""
    try:
        data = await c.execute(sid, HUBSPOT_PIPELINES, {"objectType": "deals"})
    except ComposioError as e:
        logger.warning("CONNECTIONS_TOOL_FAILED tool=%s error=%s", HUBSPOT_PIPELINES, e)
        return DealNames()
    names = deal_names(data)
    if not names.stages:
        _log_empty(HUBSPOT_PIPELINES, data)
    return names


def _named(value: Any, names: dict[str, str]) -> str | None:
    """A choice by the name the account gives it. An id that is only a number tells a reader nothing, so it is left out."""
    key = str(value or "").strip()
    if not key:
        return None
    return names.get(key) or (None if key.isdigit() else key)


def _deal_state(props: dict[str, Any]) -> str | None:
    """Open, won or lost, from HubSpot's own flags: what is said of a stage whose name could not be read."""
    closed, won = (str(props.get(k) or "").strip().lower() for k in ("hs_is_closed", "hs_is_closed_won"))
    if won == "true":
        return "Closed won"
    if closed == "true":
        return "Closed lost"
    return "Open" if closed == "false" else None


def hubspot_readable(obj: CrmObject, props: dict[str, Any], names: DealNames) -> dict[str, Any]:
    """HubSpot's values as a person reads them: a stage by its name, an amount with its currency, a close date as a day."""
    out = dict(props)
    if obj.name == "contact":
        out["lifecyclestage"] = _named(props.get("lifecyclestage"), {})
    if obj.name != "deal":
        return out
    pipeline, stage = (str(props.get(k) or "").strip() for k in ("pipeline", "dealstage"))
    out["pipeline"] = _named(pipeline, names.pipelines)
    out["dealstage"] = names.stages.get((pipeline, stage)) or names.stages.get(("", stage)) or _named(stage, {}) or _deal_state(props)
    amount, currency = props.get("amount"), str(props.get("deal_currency_code") or "").strip()
    if amount not in (None, "") and currency:
        out["amount"] = f"{amount} {currency}"
    if props.get("closedate"):
        out["closedate"] = human_when(_when(props["closedate"])[:10])
    return out


def _hubspot_title(obj: CrmObject, props: dict[str, Any]) -> str:
    name = " ".join(str(props.get(k) or "").strip() for k in _HUBSPOT_NAMES[obj.name]).strip()
    return _short(name or props.get("email") or f"({obj.label.lower()} with no name)")


def hubspot_items(kind: str) -> Callable[[Any], list[PreviewItem]]:
    """A parser for one kind: a HubSpot answer does not say what kind of record it holds."""
    obj = HUBSPOT_OBJECTS[kind]

    def parse(data: Any) -> list[PreviewItem]:
        out: list[PreviewItem] = []
        for r in find_records(data, ("properties", "hs_object_id"))[:MAX_RECORDS]:
            props = _hubspot_properties(r)
            rid = str(r.get("id") or props.get("hs_object_id") or "")
            if not HUBSPOT_ID.match(rid):
                continue
            out.append(PreviewItem(
                id=crm_id(obj, rid), toolkit=HUBSPOT, kind="crm_record", title=_hubspot_title(obj, props),
                when=_when(_first(props, *_HUBSPOT_MODIFIED) or r.get("updatedAt")),
                who=_short(props.get("company"), 200) if obj.name == "contact" else "",
                detail=obj.label, ref={"object": obj.name},
            ))
        return out

    return parse


DRIVE_FIELDS = "files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress))"
NOT_TRASH_OR_FOLDER = "trashed = false and mimeType != 'application/vnd.google-apps.folder'"
OUTLOOK_MAIL_FIELDS = ["id", "subject", "from", "toRecipients", "receivedDateTime"]


async def gather_tools(calls: list[tuple[str, Awaitable[Any], Callable[[Any], list[PreviewItem]]]]) -> list[PreviewItem]:
    """Several tools of one account. One failing costs its part; all failing is the account's failure."""
    results = await asyncio.gather(*(call for _tool, call, _parse in calls), return_exceptions=True)
    items: list[PreviewItem] = []
    failures: list[ComposioError] = []
    for (tool, _call, parse), data in zip(calls, results):
        if isinstance(data, ComposioError):
            logger.warning("CONNECTIONS_TOOL_FAILED tool=%s error=%s", tool, data)
            failures.append(data)
        elif isinstance(data, BaseException):
            raise data
        else:
            found = parse(data)
            if not found:
                _log_empty(tool, data)
            items.extend(found)
    if failures and len(failures) == len(calls):
        raise failures[0]
    return items


async def _gmail_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GMAIL_FETCH_EMAILS"
    data = await c.execute(sid, tool, {
        "user_id": "me", "query": "-in:chats", "max_results": MAX_EMAILS,
        "verbose": False, "include_payload": False,
    })
    items = gmail_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _google_calendar_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GOOGLECALENDAR_EVENTS_LIST"
    data = await c.execute(sid, tool, {
        "calendarId": "primary", "timeMin": _iso(now),
        "singleEvents": True, "orderBy": "startTime", "maxResults": MAX_EVENTS,
    })
    items = google_event_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _drive_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    tool = "GOOGLEDRIVE_FIND_FILE"
    data = await c.execute(sid, tool, {
        "q": NOT_TRASH_OR_FOLDER,
        "orderBy": "modifiedTime desc", "pageSize": MAX_FILES, "corpora": "user",
        "fields": DRIVE_FIELDS,
    })
    items = drive_items(data)
    if not items:
        _log_empty(tool, data)
    return items


async def _outlook_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    return await gather_tools([
        ("OUTLOOK_LIST_MESSAGES", c.execute(sid, "OUTLOOK_LIST_MESSAGES", {
            "top": MAX_EMAILS, "select": OUTLOOK_MAIL_FIELDS, "orderby": ["receivedDateTime desc"],
        }), outlook_mail_items),
        # A calendar view has to have an end: a year out is as far as anyone plans a meeting here.
        ("OUTLOOK_GET_CALENDAR_VIEW", c.execute(sid, "OUTLOOK_GET_CALENDAR_VIEW", {
            "start_datetime": _iso(now), "end_datetime": _iso(now + timedelta(days=365)), "top": MAX_EVENTS,
            "select": ["id", "subject", "start", "end", "organizer", "attendees", "location", "isCancelled"],
            "orderby": "start/dateTime asc",
        }), outlook_event_items),
    ])


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


SALESFORCE_QUERY = "SALESFORCE_RUN_SOQL_QUERY"


async def salesforce_query(c: Composio, sid: str, obj: CrmObject, where: str, tail: str = "") -> Any:
    """One SOQL query. A field this person's profile may not see fails the whole query, so it is tried again with only what every profile sees."""
    try:
        soql = f"SELECT {', '.join(salesforce_fields(obj))} FROM {obj.name} {where} {tail}".strip()
        return await c.execute(sid, SALESFORCE_QUERY, {"query": soql})
    except ComposioError as e:
        logger.warning("CONNECTIONS_TOOL_FAILED tool=%s object=%s error=%s", SALESFORCE_QUERY, obj.name, e)
        soql = f"SELECT {', '.join(salesforce_fields(obj, full=False))} FROM {obj.name} {where} {tail}".strip()
        return await c.execute(sid, SALESFORCE_QUERY, {"query": soql})


async def _salesforce_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    """What is being worked on: the open opportunities, newest first."""
    obj = SALESFORCE_OBJECTS["Opportunity"]
    data = await salesforce_query(c, sid, obj, "WHERE IsClosed = false", f"ORDER BY LastModifiedDate DESC LIMIT {MAX_RECORDS}")
    items = salesforce_items(data, default=obj.name)
    if not items:
        _log_empty(SALESFORCE_QUERY, data)
    return items


async def _hubspot_preview(c: Composio, sid: str, now: datetime) -> list[PreviewItem]:
    """What is being worked on: the deals changed most recently."""
    obj = HUBSPOT_OBJECTS["deal"]
    try:
        tool = obj.tool
        data = await c.execute(sid, tool, {
            "sorts": [{"propertyName": "hs_lastmodifieddate", "direction": "DESCENDING"}],
            "limit": MAX_RECORDS, "properties": hubspot_properties(obj),
        })
    except ComposioError as e:
        logger.warning("CONNECTIONS_TOOL_FAILED tool=%s error=%s", obj.tool, e)
        tool = "HUBSPOT_LIST_DEALS"
        data = await c.execute(sid, tool, {"limit": MAX_RECORDS, "properties": hubspot_properties(obj)})
    items = hubspot_items(obj.name)(data)
    if not items:
        _log_empty(tool, data)
    return items


PREVIEWS = {
    GMAIL: _gmail_preview,
    GOOGLE_CALENDAR: _google_calendar_preview,
    GOOGLE_DRIVE: _drive_preview,
    OUTLOOK: _outlook_preview,
    ONE_DRIVE: _onedrive_preview,
    SALESFORCE: _salesforce_preview,
    HUBSPOT: _hubspot_preview,
}


def ordered(items: list[PreviewItem]) -> list[PreviewItem]:
    """Meetings soonest first, then mail, files and CRM records, each newest first."""
    meetings = sorted((i for i in items if i.kind == "calendar_event"), key=lambda i: i.when)
    mail = sorted((i for i in items if i.kind == "email"), key=lambda i: i.when, reverse=True)
    files = sorted((i for i in items if i.kind == "file"), key=lambda i: i.when, reverse=True)
    records = sorted((i for i in items if i.kind == "crm_record"), key=lambda i: i.when, reverse=True)
    return meetings + mail + files + records


async def across_accounts(
    c: Composio, user_id: str, toolkits: list[str], run: Callable[[str, str], Awaitable[list[PreviewItem]]]
) -> tuple[list[PreviewItem], list[Problem]]:
    """`run(toolkit, session)` for each account, together. One failing doesn't stop the others."""
    wanted = [t for t in toolkits if t in TOOLKITS]
    if not wanted:
        return [], []
    session = await c.create_session(user_id, wanted)
    results = await asyncio.gather(*(run(t, session) for t in wanted), return_exceptions=True)
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


async def preview(c: Composio, user_id: str, toolkits: list[str], now: datetime | None = None) -> tuple[list[PreviewItem], list[Problem]]:
    """The newest of each kind and the next meetings, without their contents."""
    at = now or datetime.now(timezone.utc)
    return await across_accounts(c, user_id, toolkits, lambda t, session: PREVIEWS[t](c, session, at))


# ---------------------------------------------------------------------------
# Reading what was chosen.
# ---------------------------------------------------------------------------


def _decode_b64(data: str) -> bytes:
    padded = data.replace("-", "+").replace("_", "/")
    padded += "=" * (-len(padded) % 4)
    return base64.b64decode(padded)


def _gmail_body(record: dict[str, Any]) -> tuple[str, str]:
    """The message as its reader saw it, and where that came from.

    The HTML part first, read as visible text only (`html_to_text` drops what a
    style hides); then the plain part; and only then Composio's own `messageText`,
    which is its conversion of the HTML and keeps hidden text. Seen on production,
    7 Nov: a `display:none` instruction arrived through `messageText`.
    """
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

    walk(record.get("payload") or {})
    if any(r.strip() for r in rich):
        return html_to_text("\n".join(rich)), "html"
    if any(p.strip() for p in plain):
        return "\n".join(plain), "plain"
    direct = _first(record, "messageText", "message_text", "text", "body", "preview.body", "snippet")
    if isinstance(direct, str) and direct.strip():
        return direct, "converted"
    return "", "none"


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
    raw_body, came_from = _gmail_body(record)
    # Which path, never what it said: on production this shows whether the parts came back.
    logger.info("CONNECTIONS_GMAIL_BODY source=%s", came_from)
    body = clean_text(raw_body)
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


def _host(value: Any) -> Any:
    """A website as its host alone ("northwind.example"): every link is taken out of what is read, and a host is not one."""
    if not isinstance(value, str) or not value.strip():
        return value
    host = re.sub(r"^[a-z][a-z0-9+.-]*://", "", value.strip(), flags=re.IGNORECASE)
    return re.sub(r"^www\.", "", re.split(r"[/?#\s]", host, maxsplit=1)[0], flags=re.IGNORECASE)


async def _read_salesforce(c: Composio, sid: str, item: PickedItem) -> ConnectedText:
    obj, rid = split_crm_id(item.id, SALESFORCE_OBJECTS, SALESFORCE_ID)
    data = await salesforce_query(c, sid, obj, f"WHERE Id = '{rid}'", "LIMIT 1")
    record = find_object(data, ("Id",))
    if record is None:
        _log_empty(SALESFORCE_QUERY, data)
        raise ComposioError("That record is no longer there.", 404)
    if "Website" in record:
        record = {**record, "Website": _host(record["Website"])}
    title = _short(_first(record, "Name") or item.title)
    when = human_when(_when(_first(record, "LastModifiedDate")))
    return ConnectedText(id=item.id, toolkit=SALESFORCE, kind="crm_record", source=_source("Salesforce", obj.label, when),
                         title=title, text=_record_text(obj, title, record, when))


async def _read_hubspot(c: Composio, sid: str, item: PickedItem, names: Awaitable[DealNames] | None = None) -> ConnectedText:
    obj, rid = split_crm_id(item.id, HUBSPOT_OBJECTS, HUBSPOT_ID)
    data = await c.execute(sid, obj.tool, {
        "filterGroups": [{"filters": [{"propertyName": "hs_object_id", "operator": "EQ", "value": rid}]}],
        "limit": 1, "properties": hubspot_properties(obj),
    })
    record = next((r for r in find_records(data, ("properties", "hs_object_id"))
                   if str(r.get("id") or _hubspot_properties(r).get("hs_object_id") or "") == rid), None)
    if record is None:
        _log_empty(obj.tool, data)
        raise ComposioError("That record is no longer there.", 404)
    props = _hubspot_properties(record)
    title = _hubspot_title(obj, props) or item.title
    when = human_when(_when(_first(props, *_HUBSPOT_MODIFIED) or record.get("updatedAt")))
    known = await names if names is not None and obj.name == "deal" else DealNames()
    return ConnectedText(id=item.id, toolkit=HUBSPOT, kind="crm_record", source=_source("HubSpot", obj.label, when),
                         title=title, text=_record_text(obj, title, hubspot_readable(obj, props, known), when))


def _is_hubspot_deal(item: PickedItem) -> bool:
    """A deal that will be read: an id that is not one is refused before anything is asked on its account."""
    kind, _, record_id = item.id.partition(":")
    return item.toolkit == HUBSPOT and item.kind == "crm_record" and kind == "deal" and bool(HUBSPOT_ID.match(record_id))


async def _read_one(c: Composio, sid: str, item: PickedItem, names: Awaitable[DealNames] | None = None) -> ConnectedText | ConnectedFile:
    if item.kind == "crm_record":
        if item.toolkit == SALESFORCE:
            return await _read_salesforce(c, sid, item)
        return await _read_hubspot(c, sid, item, names)
    if item.kind == "email":
        return await (_read_gmail if item.toolkit == GMAIL else _read_outlook_mail)(c, sid, item)
    if item.kind == "calendar_event":
        return await (_read_google_event if item.toolkit == GOOGLE_CALENDAR else _read_outlook_event)(c, sid, item)
    if not _readable(item.ref.get("mime", "")):
        raise ComposioError(NOT_READABLE)
    return await _read_file(c, sid, item, item.toolkit)


_VALID = {(GMAIL, "email"), (OUTLOOK, "email"), (GOOGLE_CALENDAR, "calendar_event"), (OUTLOOK, "calendar_event"),
          (GOOGLE_DRIVE, "file"), (ONE_DRIVE, "file"), (SALESFORCE, "crm_record"), (HUBSPOT, "crm_record")}


async def read(c: Composio, user_id: str, picked: list[PickedItem]) -> tuple[list[ConnectedText], list[ConnectedFile], list[Skipped]]:
    """The full text of each item. An item that can't be read is listed with the reason, not dropped silently."""
    picked = picked[:MAX_PICKED]
    valid = [p for p in picked if (p.toolkit, p.kind) in _VALID]
    skipped = [Skipped(id=p.id, title=p.title, reason="This isn't something PromptMaster reads.") for p in picked if p not in valid]
    if not valid:
        return [], [], skipped
    session = await c.create_session(user_id, sorted({p.toolkit for p in valid}))
    # Asked once and shared: every deal read here is named from the same list of pipelines.
    names = asyncio.ensure_future(hubspot_deal_names(c, session)) if any(_is_hubspot_deal(p) for p in valid) else None
    results = await asyncio.gather(*(_read_one(c, session, p, names) for p in valid), return_exceptions=True)
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
