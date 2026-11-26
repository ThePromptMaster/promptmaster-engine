"""Outreach email (Sean, 26 Nov: "PromptMaster email workflow from a rough list to sent messages").

A thin shell over `promptmaster.outreach_mail`. Stores nothing: the person's senders, signatures and
logos live in Supabase under their own RLS, written by the browser.

`GET /api/outreach/mailbox`: which connected mailboxes can send, and the address each sends as.
Like every connections route it is the signed-in person's own, never a guest's or a worker's.
No model call.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import AuthUser
from deps import get_client, get_composio
from promptmaster.composio_client import Account, Composio, ComposioError
from promptmaster.connections import TOOLKITS
from promptmaster.errors import PRESERVED_STAGE_VERSIONS
from promptmaster.limits import MAX_INSTRUCTION_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.outreach_drafting import DraftedMessage, draft_message
from promptmaster.schemas import PMInput, WebUse
from promptmaster.web_search import WebAccess, with_web
from routers._errors import llm_http_error
from routers.stage import _model_used
from promptmaster.outreach_mail import MAX_CHECK_ADDRESSES, MAX_CHECK_DOMAINS, SENDING_TOOLKITS, mailbox_address, sent_check
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


class SentCheckRequest(BaseModel):
    addresses: list[str] = Field(default_factory=list, max_length=MAX_CHECK_ADDRESSES)
    domains: list[str] = Field(default_factory=list, max_length=MAX_CHECK_DOMAINS)


class SentOut(BaseModel):
    address: str
    on: str
    subject: str
    thread_url: str


class ColleagueOut(SentOut):
    domain: str


class SentCheckResponse(BaseModel):
    #: False when no Gmail is connected: nothing was searched, so nothing found means nothing.
    checked: bool
    sent: list[SentOut]
    colleagues: list[ColleagueOut]


@router.post("/sent-check")
async def api_sent_check(
    req: SentCheckRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> SentCheckResponse:
    """Who the person's Gmail has already written to, among these addresses and companies.

    The date, the subject and a link to each thread; never a message's text. No model call.
    The page calls this when the list changes, never Go.
    """
    accounts = [a for a in await _accounts(composio, user) if a.status == "ACTIVE" and a.toolkit == "gmail"]
    if not accounts:
        return SentCheckResponse(checked=False, sent=[], colleagues=[])
    try:
        by_address, by_domain = await sent_check(composio, user.id, req.addresses, req.domains)
    except ComposioError:
        raise HTTPException(status_code=502, detail="Your Sent mail could not be searched just now. Nothing was read.")
    return SentCheckResponse(
        checked=True,
        sent=[SentOut(address=h.address, on=h.on, subject=h.subject, thread_url=h.thread_url) for h in by_address.values()],
        colleagues=[ColleagueOut(domain=d, address=h.address, on=h.on, subject=h.subject, thread_url=h.thread_url) for d, h in by_domain.items()],
    )


class DraftMessageRequest(BaseModel):
    inputs: PMInput
    #: The Brief stage's text.
    brief: str = Field(default="", max_length=MAX_INSTRUCTION_CHARS)
    model: str = ""
    web_access: WebAccess = "off"


class DraftMessageResponse(DraftedMessage, WebUse):
    model_used: str = ""


@router.post("/draft-message")
async def api_draft_message(req: DraftMessageRequest, client: OpenRouterClient = Depends(get_client)) -> DraftMessageResponse:
    """The standard first email and its follow-up, from the brief. 1 LLM call, plus a search when the web is on and wanted."""
    try:
        inputs, web = await with_web(
            client,
            req.model or None,
            req.inputs,
            req.web_access,
            task="Write a short outreach email from this brief:\n" + req.brief[:1500],
            task_if_held="Write a short outreach email from the user's brief.",
        )
        message, _usage = await draft_message(client, req.model or None, inputs, req.brief)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_STAGE_VERSIONS)
    return DraftMessageResponse(**message.model_dump(), **web.model_dump(), model_used=_model_used(req.model, client))
