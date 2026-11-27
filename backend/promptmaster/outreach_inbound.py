"""What came back after an outreach email (Sean, 26 Nov: follow-ups stop when someone replies, a
bounce or an opt-out stops everything to that address, and a reply naming the right person
becomes the next contact).

Rules first, all in code: a bounce from the mail system that names the recipient; an automatic
reply, recorded but stopping nothing; an opt-out by its words; anything else from the recipient,
or in the thread from someone other than the sender, is a reply. The reply's text is kept cleaned
of the quoted email beneath it, as someone else's words.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Kind = Literal["reply", "auto_reply", "bounce", "opt_out"]

#: Conservative: only words that ask to stop (L-313). "Not interested" counts.
OPT_OUT = re.compile(
    r"\b(unsubscribe|remove me|take me off|stop (emailing|contacting|sending|writing)|opt(?:-| )?out|"
    r"do not (contact|email|write)|don'?t (contact|email|write)|no more emails|not interested)\b",
    re.IGNORECASE,
)
AUTO_SUBJECT = re.compile(r"^\s*(automatic reply|auto(?:-| )?reply|out of (the )?office|ooo\b|on (vacation|holiday|leave)|away from (the )?office|autoreply)", re.IGNORECASE)
AUTO_TEXT = re.compile(r"\b(i am|i'm) (currently )?(out of (the )?office|away|on (vacation|holiday|leave))\b|\bthis is an automatic(ally generated)? (reply|response|message)\b", re.IGNORECASE)
BOUNCE_FROM = re.compile(r"^(mailer-daemon|postmaster|mail-daemon)@", re.IGNORECASE)
BOUNCE_SUBJECT = re.compile(r"(delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|returned mail|delivery (has )?failed|failure notice|address not found)", re.IGNORECASE)
_QUOTE_START = re.compile(r"^(on .{3,200} wrote:|-{2,}\s*original message\s*-{2,}|from: .+@.+|sent from my \w+)", re.IGNORECASE)
_ADDRESS = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

WEBMAIL = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
    "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "web.de",
    "mail.com", "zoho.com", "yandex.com", "fastmail.com", "hey.com",
})

MAX_TEXT = 4_000


@dataclass(frozen=True)
class Inbound:
    kind: Kind
    message_id: str
    from_address: str
    subject: str
    #: The reply's own words, without the quoted email under it.
    text: str
    #: ISO time it arrived ('' when the mailbox did not say).
    at: str
    #: A reply from the recipient's company domain (not a webmail address): other emails to it wait.
    company_domain: str = ""


def address_of(raw: str) -> str:
    found = _ADDRESS.findall(raw or "")
    return found[0].lower() if found else ""


_ATTRIBUTION_START = re.compile(r"^(on|le|am|el|em)\s", re.IGNORECASE)
_ATTRIBUTION_END = re.compile(r"(wrote|a écrit|schrieb|escribió|escreveu)\s*:\s*$", re.IGNORECASE)


def clean_reply(text: str) -> str:
    """The reply above the quoted email: quoted lines and everything from "On … wrote:" dropped,
    including the attribution Gmail wraps over two or three lines (27 Nov pass)."""
    kept: list[str] = []
    lines = (text or "").replace("\r\n", "\n").split("\n")
    for i, line in enumerate(lines):
        stripped = line.strip()
        if _QUOTE_START.match(stripped):
            break
        if _ATTRIBUTION_START.match(stripped) and any(_ATTRIBUTION_END.search(l.strip()) for l in lines[i : i + 3]):
            break
        if stripped.startswith(">"):
            continue
        kept.append(line.rstrip())
    out = "\n".join(kept).strip()
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out[:MAX_TEXT]


def classify(*, from_address: str, subject: str, text: str, recipient: str, ours: str) -> Kind | None:
    """What one message is, for the email sent to `recipient` from `ours`; None when it is not about it."""
    sender = address_of(from_address)
    if not sender or sender == ours.lower():
        return None
    if BOUNCE_FROM.match(sender) or BOUNCE_SUBJECT.search(subject or ""):
        # A bounce counts only when it names the address written to.
        return "bounce" if recipient.lower() in (text or "").lower() or recipient.lower() in (subject or "").lower() else None
    if AUTO_SUBJECT.search(subject or "") or AUTO_TEXT.search((text or "")[:600]):
        return "auto_reply"
    if OPT_OUT.search(clean_reply(text) or subject or ""):
        return "opt_out"
    return "reply"


def company_domain(from_address: str, recipient: str) -> str:
    """The company that replied, when the reply comes from the recipient's own (non-webmail) domain."""
    sender = address_of(from_address)
    domain = sender.split("@", 1)[1] if "@" in sender else ""
    theirs = recipient.lower().split("@", 1)[1] if "@" in recipient else ""
    return domain if domain and domain == theirs and domain not in WEBMAIL else ""
