"""Outreach email (Sean, 26 Nov: "PromptMaster email workflow from a rough list to sent messages").

A thin shell over `promptmaster.outreach_mail`. Stores nothing: the person's senders, signatures and
logos live in Supabase under their own RLS, written by the browser.

`GET /api/outreach/mailbox`: which connected mailboxes can send, and the address each sends as.
Like every connections route it is the signed-in person's own, never a guest's or a worker's.
No model call.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import AuthUser
from deps import get_composio
from promptmaster.composio_client import Account, Composio
from promptmaster.connections import TOOLKITS
from promptmaster.outreach_mail import SENDING_TOOLKITS, mailbox_address
from routers.connections import _accounts, connecting_user

router = APIRouter(prefix="/api/outreach", tags=["outreach"])


class MailboxOut(BaseModel):
    toolkit: str
    label: str
    connection_id: str
    #: The address it sends as; "" when the mailbox could not say.
    address: str


class MailboxResponse(BaseModel):
    mailboxes: list[MailboxOut]


@router.get("/mailbox")
async def api_mailbox(user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)) -> MailboxResponse:
    """The connected Gmail and Outlook accounts, each with the address it sends as."""
    accounts = [a for a in await _accounts(composio, user) if a.status == "ACTIVE" and a.toolkit in SENDING_TOOLKITS]
    # One per kind: Composio keeps one grant per provider (L-201).
    seen: dict[str, Account] = {}
    for a in accounts:
        seen.setdefault(a.toolkit, a)
    chosen = sorted(seen.values(), key=lambda a: SENDING_TOOLKITS.index(a.toolkit))
    found = await asyncio.gather(*(mailbox_address(composio, user.id, a.toolkit) for a in chosen))
    return MailboxResponse(
        mailboxes=[
            MailboxOut(
                toolkit=a.toolkit,
                label=TOOLKITS[a.toolkit].label,
                connection_id=a.id,
                address=m.address if m else "",
            )
            for a, m in zip(chosen, found)
        ]
    )
