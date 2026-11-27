"""One approved outreach email, exactly (Sean, 26 Nov: "Let me approve one email or a selected batch.
Record the exact version I approved. If someone changes the recipient, body, link, attachment, or
sender after approval, send that message back for review").

The browser renders the email (`lib/outreach/render.ts`) into a snapshot: who it is from and to,
the subject, the HTML and text bodies and their links. The approval stores that snapshot. This
module:
- hashes it canonically, so "the same email" means the same bytes;
- checks it may go out at all (one recipient, the person's own mailbox as sender, nothing left to
  fill in, the commercial footer present);
- mints the ticket that lets the job runner send it, and checks that ticket before anything is sent.

The ticket is an HMAC over the user, the approval, its purpose and the hash, with a secret only
this backend holds (`OUTREACH_TICKET_SECRET`). The worker credential alone cannot send: it would
also need a ticket, and a ticket only covers the one email it was minted for, for the one person.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from typing import Any, Literal

from pydantic import BaseModel, Field

Purpose = Literal["send", "test", "followup"]

MAX_TO = 1
MAX_COPY = 5
_ADDRESS = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+$")
_PLACEHOLDER = re.compile(r"\{\{\s*[a-zA-Z_]+\s*\}\}|\[(?:[A-Z][a-z]+)(?: [A-Za-z]+){0,3}\]|\b(?:TBD|TBC|TODO|XXX*)\b")


class Party(BaseModel):
    name: str = Field(default="", max_length=200)
    address: str = Field(max_length=320)


class Snapshot(BaseModel):
    """The email as it goes out. `lib/outreach/snapshot.ts` builds the same shape."""

    v: int = 1
    provider: Literal["gmail", "outlook"] = "gmail"
    from_: Party = Field(alias="from")
    reply_to: str = Field(default="", max_length=320)
    to: list[str] = Field(default_factory=list, max_length=10)
    cc: list[str] = Field(default_factory=list, max_length=10)
    bcc: list[str] = Field(default_factory=list, max_length=10)
    subject: str = Field(default="", max_length=300)
    html: str = Field(default="", max_length=200_000)
    text: str = Field(default="", max_length=100_000)
    links: list[str] = Field(default_factory=list, max_length=50)
    commercial: bool = False
    #: The postal address and opt-out line the footer carries, as sent.
    footer: str = Field(default="", max_length=1_000)
    signature_id: str = Field(default="", max_length=80)
    sender_id: str = Field(default="", max_length=80)

    model_config = {"populate_by_name": True}


def canonical(value: Any) -> str:
    """Sorted keys, no spaces, UTF-8 kept: the same email always gives the same bytes."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def snapshot_hash(snapshot: dict[str, Any]) -> str:
    return hashlib.sha256(canonical(snapshot).encode("utf-8")).hexdigest()


def ticket_secret() -> str:
    """Read per call, so a rotated secret takes effect without a redeploy. Empty means sending is off."""
    return os.getenv("OUTREACH_TICKET_SECRET", "").strip()


def sending_enabled() -> bool:
    """The kill switch: OUTREACH_SENDING=off stops every send at once."""
    return os.getenv("OUTREACH_SENDING", "on").strip().lower() != "off" and bool(ticket_secret())


def mint_ticket(user_id: str, approval_id: str, purpose: str, message_hash: str) -> str:
    message = f"v1\n{user_id}\n{approval_id}\n{purpose}\n{message_hash}".encode("utf-8")
    return hmac.new(ticket_secret().encode("utf-8"), message, hashlib.sha256).hexdigest()


def ticket_valid(ticket: str, user_id: str, approval_id: str, purpose: str, message_hash: str) -> bool:
    if not ticket_secret() or not re.fullmatch(r"[0-9a-f]{64}", ticket or ""):
        return False
    return hmac.compare_digest(ticket.encode("utf-8"), mint_ticket(user_id, approval_id, purpose, message_hash).encode("utf-8"))


def problems(snapshot: Snapshot, purpose: str, mailbox: str) -> list[str]:
    """Why this email may not go out, in plain words; [] when it may."""
    out: list[str] = []
    sender = snapshot.from_.address.strip().lower()
    if not mailbox:
        out.append("The connected mailbox could not say which address it sends as.")
    elif sender != mailbox.strip().lower():
        out.append(f"It is from {sender}, but the connected mailbox sends as {mailbox}.")
    if len(snapshot.to) != MAX_TO:
        out.append("An outreach email goes to exactly one person.")
    if len(snapshot.cc) > MAX_COPY or len(snapshot.bcc) > MAX_COPY:
        out.append(f"At most {MAX_COPY} people in Cc and in Bcc.")
    for address in [*snapshot.to, *snapshot.cc, *snapshot.bcc, *([snapshot.reply_to] if snapshot.reply_to else [])]:
        if not _ADDRESS.match(address.strip()):
            out.append(f"{address!r} is not an email address.")
    if purpose == "test" and ([a.strip().lower() for a in snapshot.to] != [mailbox.strip().lower()] or snapshot.cc or snapshot.bcc):
        out.append("A test goes only to your own mailbox.")
    if not snapshot.subject.strip():
        out.append("It has no subject.")
    if not snapshot.html.strip() or not snapshot.text.strip():
        out.append("It has no body.")
    left = sorted(set(_PLACEHOLDER.findall(f"{snapshot.subject}\n{snapshot.text}")))
    if left:
        out.append("Still to fill in: " + ", ".join(left) + ".")
    if any(not link.startswith("https://") for link in snapshot.links):
        out.append("Every link must start with https://.")
    if snapshot.commercial and not snapshot.footer.strip():
        out.append("A commercial email needs your postal address and an opt-out line.")
    return out


_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def _plain(html: str) -> str:
    import html as html_lib

    return _SPACE.sub(" ", html_lib.unescape(_TAGS.sub(" ", html or ""))).strip()


def received_checks(snapshot: dict[str, Any], received: str) -> list[dict[str, Any]]:
    """What a test email looks like once it arrived (Sean, 26 Nov: "Check how it looks in the received
    email, including whether the logo shows up where I put it and whether the signature appears twice")."""
    sent_html = str(snapshot.get("html") or "")
    checks: list[dict[str, Any]] = []
    if not received:
        return [{"key": "received", "ok": False, "detail": "The email was not found in your mailbox yet."}]
    logo = re.search(r'<img[^>]*src="([^"]+)"', sent_html)
    name = re.search(r'<div style="font-weight:bold">([^<]+)</div>', sent_html)
    if logo:
        at = received.find(logo.group(1))
        checks.append({"key": "logo", "ok": at >= 0, "detail": "" if at >= 0 else "The logo is not in the email that arrived."})
        if at >= 0 and name:
            under = received.find(name.group(1)) < at
            checks.append({"key": "logo_under", "ok": under, "detail": "" if under else "The logo is not under the signature."})
    if name:
        count = received.count(name.group(1))
        expected = sent_html.count(name.group(1))
        checks.append({"key": "signature_once", "ok": count == expected, "detail": "" if count == expected else f"The signature name appears {count} times."})
    missing = [link for link in snapshot.get("links") or [] if link not in received]
    checks.append({"key": "links", "ok": not missing, "detail": ", ".join(missing)})
    same = _plain(sent_html)[:400] in _plain(received)
    checks.append({"key": "body", "ok": same, "detail": "" if same else "What arrived differs from what was approved."})
    return checks
