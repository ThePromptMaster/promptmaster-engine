"""Composio's REST API, called on a person's behalf (the client's call, 7 Nov).

Composio holds each person's Google and Microsoft connections, keyed by their
Supabase user id. This backend still stores nothing: it asks Composio for a
consent link, runs a read tool through a session, and hands the result on, the
way it hands a prompt to OpenRouter.

The `composio` SDK is not used. It pulls in an OpenAI client and a websocket
library, its calls block the event loop, and this needs six endpoints. Their
paths and fields are the ones the SDK (0.31) sends.
"""

from __future__ import annotations

import itertools
import logging
import os
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlencode, urlparse, parse_qsl, urlunparse

import httpx

logger = logging.getLogger(__name__)

BASE_URL = "https://backend.composio.dev"
API = "/api/v3.1"
TIMEOUT = 25.0


class ComposioError(Exception):
    """A Composio call failed. `status` is Composio's HTTP status, when there was one."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Account:
    """One connected account, as Composio reports it."""

    id: str
    toolkit: str
    status: str
    user_id: str
    created_at: str = ""


def to_account(raw: dict[str, Any]) -> Account:
    toolkit = raw.get("toolkit")
    slug = toolkit.get("slug") if isinstance(toolkit, dict) else toolkit
    return Account(
        id=str(raw.get("id") or ""),
        toolkit=str(slug or "").lower(),
        status=str(raw.get("status") or "").upper(),
        user_id=str(raw.get("user_id") or ""),
        created_at=str(raw.get("created_at") or ""),
    )


class Composio(Protocol):
    async def create_session(self, user_id: str, toolkits: list[str]) -> str: ...
    async def link(self, session_id: str, toolkit: str, callback_url: str) -> tuple[str, str]: ...
    async def execute(self, session_id: str, tool: str, arguments: dict[str, Any]) -> Any: ...
    async def accounts(self, user_id: str) -> list[Account]: ...
    async def account(self, account_id: str) -> Account | None: ...
    async def delete(self, account_id: str, revoke: bool = True) -> None: ...


def _error_message(response: httpx.Response) -> str:
    """Composio's own words for a failure, never a person's data: a 4xx body is about the request."""
    try:
        body = response.json()
    except ValueError:
        return f"Composio returned HTTP {response.status_code}."
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            err = err.get("message") or err.get("code")
        message = err or body.get("message") or body.get("detail")
        if message:
            return f"Composio returned HTTP {response.status_code}: {str(message)[:200]}"
    return f"Composio returned HTTP {response.status_code}."


class ComposioClient:
    """The live API, with the project key from COMPOSIO_API_KEY."""

    def __init__(self, api_key: str, base_url: str = BASE_URL):
        self._http = httpx.AsyncClient(base_url=base_url, headers={"x-api-key": api_key}, timeout=TIMEOUT)

    async def close(self) -> None:
        await self._http.aclose()

    async def _call(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._http.request(method, API + path, json=json, params=params)
        except httpx.HTTPError as e:
            raise ComposioError(f"Composio could not be reached ({type(e).__name__}).") from e
        if response.status_code >= 400:
            raise ComposioError(_error_message(response), response.status_code)
        try:
            body = response.json()
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {"data": body}

    async def create_session(self, user_id: str, toolkits: list[str]) -> str:
        body = await self._call(
            "POST", "/tool_router/session", json={"user_id": user_id, "toolkits": {"enable": toolkits}}
        )
        session_id = body.get("session_id")
        if not session_id:
            raise ComposioError("Composio did not return a session.")
        return str(session_id)

    async def link(self, session_id: str, toolkit: str, callback_url: str) -> tuple[str, str]:
        """The consent link for one toolkit, and the id the new connection will have."""
        body = await self._call(
            "POST",
            f"/tool_router/session/{session_id}/link",
            json={"toolkit": toolkit, "callback_url": callback_url},
        )
        redirect = body.get("redirect_url")
        if not redirect:
            raise ComposioError("Composio did not return a consent link.")
        return str(redirect), str(body.get("connected_account_id") or "")

    async def execute(self, session_id: str, tool: str, arguments: dict[str, Any]) -> Any:
        body = await self._call(
            "POST",
            f"/tool_router/session/{session_id}/execute",
            json={"tool_slug": tool, "arguments": arguments},
        )
        if body.get("error") or body.get("result_type") == "failed":
            raise ComposioError(f"{tool} failed: {str(body.get('error') or 'no reason given')[:200]}")
        return body.get("data")

    async def accounts(self, user_id: str) -> list[Account]:
        body = await self._call(
            "GET",
            "/connected_accounts",
            params={"user_ids": user_id, "limit": "50", "order_by": "created_at", "order_direction": "desc"},
        )
        items = body.get("items") or []
        return [to_account(i) for i in items if isinstance(i, dict)]

    async def account(self, account_id: str) -> Account | None:
        try:
            body = await self._call("GET", f"/connected_accounts/{account_id}")
        except ComposioError as e:
            if e.status == 404:
                return None
            raise
        return to_account(body)

    async def delete(self, account_id: str, revoke: bool = True) -> None:
        """Remove the connection; with `revoke`, withdraw the grant at Google or Microsoft too."""
        await self._call("DELETE", f"/connected_accounts/{account_id}", params={"revoke_on_delete": "true" if revoke else "false"})


# ---------------------------------------------------------------------------
# Mock mode, for the browser tests and local runs without a key.
# ---------------------------------------------------------------------------

def _with_query(url: str, **params: str) -> str:
    parts = urlparse(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + list(params.items())
    return urlunparse(parts._replace(query=urlencode(query)))


class MockComposio:
    """Scripted accounts and tool results. One process, so state lives here."""

    def __init__(self) -> None:
        self._accounts: dict[str, Account] = {}
        self._sessions: dict[str, str] = {}
        self._ids = itertools.count(1)
        self.deleted: list[str] = []

    async def create_session(self, user_id: str, toolkits: list[str]) -> str:
        session_id = f"mock_session_{next(self._ids)}"
        self._sessions[session_id] = user_id
        return session_id

    async def link(self, session_id: str, toolkit: str, callback_url: str) -> tuple[str, str]:
        account_id = f"mock_{toolkit}_{next(self._ids)}"
        self._accounts[account_id] = Account(account_id, toolkit, "ACTIVE", self._sessions[session_id])
        # There is no consent screen to visit: straight back, as Composio would after a yes.
        return _with_query(callback_url, status="success", connected_account_id=account_id), account_id

    async def execute(self, session_id: str, tool: str, arguments: dict[str, Any]) -> Any:
        from promptmaster import composio_mock_data

        return composio_mock_data.result(tool, arguments)

    async def accounts(self, user_id: str) -> list[Account]:
        return [a for a in self._accounts.values() if a.user_id == user_id]

    async def account(self, account_id: str) -> Account | None:
        return self._accounts.get(account_id)

    async def delete(self, account_id: str, revoke: bool = True) -> None:
        self._accounts.pop(account_id, None)
        self.deleted.append(account_id)
        self.revoked = getattr(self, "revoked", []) + ([account_id] if revoke else [])


# ---------------------------------------------------------------------------
# The dependency.
# ---------------------------------------------------------------------------

_live: ComposioClient | None = None
_mock: MockComposio | None = None


def composio_mode() -> str:
    """'mock' serves scripted accounts (E2E only), refused in production like PM_LLM_MODE."""
    mode = os.getenv("COMPOSIO_MODE", "").strip().lower()
    if mode == "mock" and os.getenv("VERCEL_ENV", "").strip().lower() == "production":
        raise RuntimeError("COMPOSIO_MODE=mock is not allowed when VERCEL_ENV=production")
    return "mock" if mode == "mock" else "live"


class NotConfigured(ComposioError):
    """No COMPOSIO_API_KEY on this server."""


def build_composio() -> Composio:
    """The client for this process. Built on first use, so the key can be set without a code change."""
    global _live, _mock
    if composio_mode() == "mock":
        if _mock is None:
            _mock = MockComposio()
        return _mock
    if _live is None:
        key = os.getenv("COMPOSIO_API_KEY", "").strip()
        if not key:
            raise NotConfigured("Account connections are not set up on this server.", 503)
        _live = ComposioClient(key, os.getenv("COMPOSIO_BASE_URL", "").strip() or BASE_URL)
    return _live
