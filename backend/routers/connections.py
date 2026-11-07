"""Connected accounts: Gmail, Google Calendar, Google Drive, Outlook, OneDrive (7 Nov).

A thin shell over `promptmaster.connections`. Composio holds each connection,
keyed by the caller's Supabase user id, and this stores nothing. Every route
that takes a connection id checks it belongs to the caller before using it:
Composio's callback parameters alone are not proof of ownership.

Reads happen only when someone presses a button, and come in two steps
(preview without contents, then the text of what was ticked). Nothing here
calls a model. A check-like route, not a writer: no `web_access`.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import AuthUser, require_user
from deps import get_composio
from promptmaster.composio_client import Account, Composio, ComposioError
from promptmaster.connections import (
    MAX_PICKED,
    TOOLKITS,
    ConnectedFile,
    ConnectedText,
    PickedItem,
    PreviewItem,
    Problem,
    Skipped,
    preview,
    read,
)

router = APIRouter(prefix="/api/connections", tags=["connections"])

CALLBACK_PATH = "/projects/connect"
SHOWN_STATUSES = ("ACTIVE", "EXPIRED")
UNREACHABLE = "Your connected accounts could not be reached just now. Nothing was read. Try again in a minute."


def connecting_user(user: AuthUser | None = Depends(require_user)) -> AuthUser:
    """A signed-in person. A guest's connection would be left behind in Composio when the guest is."""
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to connect an account.")
    if user.is_anonymous:
        raise HTTPException(status_code=403, detail="Sign in with an account to connect your mail, calendar or files.")
    if user.role == "worker":
        raise HTTPException(status_code=403, detail="Connections are only used by the person who made them.")
    return user


class ToolkitOut(BaseModel):
    slug: str
    label: str
    reads: str


class ConnectionOut(BaseModel):
    id: str
    toolkit: str
    label: str
    status: str
    connected_at: str = ""


class ConnectionsResponse(BaseModel):
    accounts: list[ConnectionOut]
    toolkits: list[ToolkitOut]


class LinkRequest(BaseModel):
    toolkit: str = Field(max_length=40)
    callback_url: str = Field(max_length=500)


class LinkResponse(BaseModel):
    redirect_url: str


class ConfirmRequest(BaseModel):
    connected_account_id: str = Field(min_length=1, max_length=200)


class DeleteResponse(BaseModel):
    deleted: bool


class PreviewRequest(BaseModel):
    toolkits: list[str] = Field(default_factory=list, max_length=len(TOOLKITS))


class PreviewResponse(BaseModel):
    items: list[PreviewItem]
    problems: list[Problem]


class ReadRequest(BaseModel):
    items: list[PickedItem] = Field(min_length=1, max_length=MAX_PICKED)


class ReadResponse(BaseModel):
    items: list[ConnectedText]
    files: list[ConnectedFile]
    skipped: list[Skipped]


def _out(a: Account) -> ConnectionOut:
    return ConnectionOut(id=a.id, toolkit=a.toolkit, label=TOOLKITS[a.toolkit].label, status=a.status, connected_at=a.created_at)


def _allowed_origins() -> set[str]:
    return {o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()}


def _check_callback(url: str) -> None:
    """Back to our own connect page only, so a consent link can't be used to send someone elsewhere."""
    parts = urlparse(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if parts.scheme not in ("https", "http") or origin not in _allowed_origins() or parts.path != CALLBACK_PATH:
        raise HTTPException(status_code=422, detail="That return address isn't one PromptMaster uses.")


async def _accounts(composio: Composio, user: AuthUser) -> list[Account]:
    try:
        found = await composio.accounts(user.id)
    except ComposioError:
        raise HTTPException(status_code=502, detail=UNREACHABLE)
    # Composio filters by user, and this checks again: a filter that was ignored would otherwise list someone else's.
    return [a for a in found if a.user_id == user.id and a.toolkit in TOOLKITS]


async def _owned(composio: Composio, user: AuthUser, account_id: str) -> Account:
    try:
        account = await composio.account(account_id)
    except ComposioError:
        raise HTTPException(status_code=502, detail=UNREACHABLE)
    if account is None or account.user_id != user.id or account.toolkit not in TOOLKITS:
        raise HTTPException(status_code=404, detail="That connection wasn't found.")
    return account


@router.get("")
async def api_list_connections(
    user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> ConnectionsResponse:
    """The caller's connected accounts, and what each kind reads."""
    accounts = [a for a in await _accounts(composio, user) if a.status in SHOWN_STATUSES]
    return ConnectionsResponse(
        accounts=[_out(a) for a in accounts],
        toolkits=[ToolkitOut(slug=t.slug, label=t.label, reads=t.reads) for t in TOOLKITS.values()],
    )


@router.post("/link")
async def api_link(
    req: LinkRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> LinkResponse:
    """The consent link for one account. The person approves on Google's or Microsoft's own screen."""
    if req.toolkit not in TOOLKITS:
        raise HTTPException(status_code=422, detail="PromptMaster doesn't connect to that.")
    _check_callback(req.callback_url)
    if any(a.toolkit == req.toolkit and a.status == "ACTIVE" for a in await _accounts(composio, user)):
        raise HTTPException(status_code=409, detail=f"{TOOLKITS[req.toolkit].label} is already connected.")
    try:
        session = await composio.create_session(user.id, [req.toolkit])
        redirect, _ = await composio.link(session, req.toolkit, req.callback_url)
    except ComposioError:
        raise HTTPException(status_code=502, detail="The connection could not be started just now. Try again in a minute.")
    return LinkResponse(redirect_url=redirect)


@router.post("/confirm")
async def api_confirm(
    req: ConfirmRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> ConnectionOut:
    """After the consent screen: the connection exists, belongs to the caller, and its status."""
    return _out(await _owned(composio, user, req.connected_account_id))


@router.delete("/{account_id}")
async def api_disconnect(
    account_id: str, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> DeleteResponse:
    """Remove the connection and revoke the grant at Google or Microsoft."""
    account = await _owned(composio, user, account_id)
    try:
        await composio.delete(account.id)
    except ComposioError:
        raise HTTPException(status_code=502, detail="The connection could not be removed just now. Try again in a minute.")
    return DeleteResponse(deleted=True)


@router.post("/preview")
async def api_preview(
    req: PreviewRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> PreviewResponse:
    """What is in each connected account, without its contents. No model call."""
    active = {a.toolkit for a in await _accounts(composio, user) if a.status == "ACTIVE"}
    wanted = [t for t in (req.toolkits or list(TOOLKITS)) if t in active]
    try:
        items, problems = await preview(composio, user.id, wanted)
    except ComposioError:
        raise HTTPException(status_code=502, detail=UNREACHABLE)
    return PreviewResponse(items=items, problems=problems)


@router.post("/read")
async def api_read(
    req: ReadRequest, user: AuthUser = Depends(connecting_user), composio: Composio = Depends(get_composio)
) -> ReadResponse:
    """The text of each ticked item, cleaned and capped. No model call: the person sees it first."""
    active = {a.toolkit for a in await _accounts(composio, user) if a.status == "ACTIVE"}
    usable = [p for p in req.items if p.toolkit in active]
    skipped = [Skipped(id=p.id, title=p.title, reason="That account is no longer connected.") for p in req.items if p.toolkit not in active]
    try:
        texts, files, more_skipped = await read(composio, user.id, usable) if usable else ([], [], [])
    except ComposioError:
        raise HTTPException(status_code=502, detail=UNREACHABLE)
    return ReadResponse(items=texts, files=files, skipped=skipped + more_skipped)
