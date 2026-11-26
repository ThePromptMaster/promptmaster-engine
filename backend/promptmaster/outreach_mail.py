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

import logging
from dataclasses import dataclass
from typing import Any

from .composio_client import Composio, ComposioError

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
