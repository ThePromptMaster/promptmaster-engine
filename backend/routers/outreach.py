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
from typing import Literal

from pydantic import BaseModel, Field

from auth import AuthUser, require_user
from deps import get_client, get_composio
from promptmaster.composio_client import Account, Composio, ComposioError
from promptmaster.connections import TOOLKITS
from promptmaster.errors import PRESERVED_STAGE_VERSIONS
from promptmaster.limits import MAX_INSTRUCTION_CHARS
from promptmaster.llm_client import OpenRouterClient, OpenRouterError
from promptmaster.outreach_drafting import DraftedMessage, draft_message
from promptmaster.outreach_research import MAX_ROWS as RESEARCH_ROWS, READ_MODEL, ResearchedRow, ResearchRow, research
from promptmaster.schemas import PMInput, WebUse
from promptmaster.web_search import WebAccess, with_web
from routers._errors import llm_http_error
from routers.stage import _model_used
from promptmaster.outreach_mail import (
    MAX_CHECK_ADDRESSES,
    MAX_CHECK_DOMAINS,
    SENDING_TOOLKITS,
    SendError,
    confirm_sent,
    create_draft,
    find_sent,
    mailbox_address,
    received_html,
    send_draft,
    sent_check,
)
from promptmaster.outreach_message import Purpose, Snapshot, mint_ticket, problems, sending_enabled, snapshot_hash, received_checks, ticket_valid
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


WEB_NEEDED = "Filling in the blanks searches the web: turn on Web access for this project first."


class ResearchRequest(BaseModel):
    inputs: PMInput
    #: The Brief stage's text: who the right person is depends on it.
    brief: str = Field(default="", max_length=MAX_INSTRUCTION_CHARS)
    rows: list[ResearchRow] = Field(default_factory=list, max_length=RESEARCH_ROWS)
    web_access: WebAccess = "off"


class ResearchResponse(WebUse):
    rows: list[ResearchedRow] = Field(default_factory=list)
    model_used: str = ""


@router.post("/research")
async def api_research(req: ResearchRequest, client: OpenRouterClient = Depends(get_client)) -> ResearchResponse:
    """Fill in up to five contacts from the web, each value with its source (`promptmaster/outreach_research.py`).

    At most two searches per contact and one model call for all of them. Refused while the
    project's Web access is off: an address is only ever what a page shows.
    """
    if req.web_access != "on":
        raise HTTPException(status_code=409, detail=WEB_NEEDED)
    if not req.rows:
        return ResearchResponse()
    try:
        rows, sources, queries, _usage = await research(client, req.inputs, req.brief, req.rows)
    except OpenRouterError as e:
        raise llm_http_error(e, PRESERVED_STAGE_VERSIONS)
    return ResearchResponse(rows=rows, web_sources=sources, web_query=" · ".join(queries)[:300], model_used=READ_MODEL)


# ---------------------------------------------------------------------------
# Approving and sending (26 Nov). The person approves an exact email and gets a ticket for it;
# the job runner sends it with that ticket, as the worker, for that person only.
# ---------------------------------------------------------------------------

OFF = "Sending email is turned off on this server."


def _on() -> None:
    if not sending_enabled():
        raise HTTPException(status_code=503, detail=OFF)


def worker_only(user: AuthUser | None = Depends(require_user)) -> AuthUser:
    """The job runner, sending for the person named in its header. Never a person's own session:
    an email goes out only through the job, which writes the record."""
    if user is None or user.role != "worker":
        raise HTTPException(status_code=403, detail="Email is sent by the job runner only.")
    return user


class TicketItem(BaseModel):
    approval_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    purpose: Purpose = "send"
    snapshot: dict


class TicketsRequest(BaseModel):
    approvals: list[TicketItem] = Field(min_length=1, max_length=50)


class TicketOut(BaseModel):
    approval_id: str
    message_hash: str = ""
    ticket: str = ""
    problems: list[str] = Field(default_factory=list)


@router.post("/tickets")
async def api_tickets(
    req: TicketsRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> list[TicketOut]:
    """Check each email may go out, and mint its ticket. The hash is computed here, never taken from the browser."""
    _on()
    box = await mailbox_address(composio, user.id, "gmail")
    mailbox = box.address if box else ""
    out: list[TicketOut] = []
    for item in req.approvals:
        try:
            snap = Snapshot.model_validate(item.snapshot)
        except ValueError:
            out.append(TicketOut(approval_id=item.approval_id, problems=["The email could not be read."]))
            continue
        found = problems(snap, item.purpose, mailbox)
        if found:
            out.append(TicketOut(approval_id=item.approval_id, problems=found))
            continue
        digest = snapshot_hash(item.snapshot)
        out.append(TicketOut(approval_id=item.approval_id, message_hash=digest, ticket=mint_ticket(user.id, item.approval_id, item.purpose, digest)))
    return out


class TicketedRequest(BaseModel):
    approval_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    purpose: Purpose = "send"
    snapshot: dict
    ticket: str = Field(pattern=r"^[0-9a-f]{64}$")


def _checked(req: TicketedRequest, user: AuthUser) -> None:
    _on()
    if not ticket_valid(req.ticket, user.id, req.approval_id, req.purpose, snapshot_hash(req.snapshot)):
        raise HTTPException(status_code=403, detail="That email was not approved as it is.")


async def _mailbox_matches(composio: Composio, user: AuthUser, snapshot: dict) -> str:
    box = await mailbox_address(composio, user.id, "gmail")
    sender = str((snapshot.get("from") or {}).get("address") or "").lower()
    if not box or box.address != sender:
        raise HTTPException(status_code=409, detail={"code": "mailbox_changed", "message": "The connected mailbox is not the one this email was approved from."})
    return box.address


def _send_error(e: SendError) -> HTTPException:
    return HTTPException(status_code=502, detail={"code": "uncertain" if e.uncertain else "not_sent", "message": str(e)})


class SendRequest(TicketedRequest):
    #: draft: make the Gmail draft; send: send the draft made before.
    step: Literal["draft", "send"]
    draft_id: str = Field(default="", max_length=200)


@router.post("/send")
async def api_send(req: SendRequest, user: AuthUser = Depends(worker_only), composio: Composio = Depends(get_composio)) -> dict:
    _checked(req, user)
    mailbox = await _mailbox_matches(composio, user, req.snapshot)
    try:
        if req.step == "draft":
            return {"draft_id": await create_draft(composio, user.id, req.snapshot)}
        if not req.draft_id:
            raise HTTPException(status_code=422, detail="Which draft?")
        sent = await send_draft(composio, user.id, req.draft_id, mailbox)
        return {"message_id": sent.message_id, "thread_id": sent.thread_id, "thread_url": sent.thread_url}
    except SendError as e:
        raise _send_error(e)


class FindSentRequest(TicketedRequest):
    after_epoch: int = Field(ge=0)


@router.post("/find-sent")
async def api_find_sent(req: FindSentRequest, user: AuthUser = Depends(worker_only), composio: Composio = Depends(get_composio)) -> dict:
    """Before any retry: did this email already go?"""
    _checked(req, user)
    mailbox = await _mailbox_matches(composio, user, req.snapshot)
    try:
        found = await find_sent(composio, user.id, req.snapshot, req.after_epoch, mailbox)
    except SendError as e:
        raise _send_error(e)
    return {"found": found is not None, **({"message_id": found.message_id, "thread_id": found.thread_id, "thread_url": found.thread_url} if found else {})}


class ConfirmRequest(TicketedRequest):
    message_id: str = Field(min_length=1, max_length=200)


@router.post("/confirm")
async def api_confirm(req: ConfirmRequest, user: AuthUser = Depends(worker_only), composio: Composio = Depends(get_composio)) -> dict:
    _checked(req, user)
    mailbox = await _mailbox_matches(composio, user, req.snapshot)
    try:
        c = await confirm_sent(composio, user.id, req.message_id, req.snapshot, mailbox)
    except SendError as e:
        raise _send_error(e)
    return {"sent": c.sent, "thread_id": c.thread_id, "thread_url": c.thread_url, "matches": c.matches}


class CheckTestRequest(BaseModel):
    snapshot: dict
    message_id: str = Field(min_length=1, max_length=200)


@router.post("/check-test")
async def api_check_test(req: CheckTestRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)) -> dict:
    """A test email as it arrived in the person's own inbox: logo, signature once, links, body. No model call."""
    try:
        html = await received_html(composio, user.id, req.message_id)
    except SendError:
        raise HTTPException(status_code=502, detail="Your mailbox could not be read just now.")
    return {"checks": received_checks(req.snapshot, html)}
