"""The job drain's machine identity.

The drain cannot present a user token. Under Vercel Cron there is no user in the
request, and a job outlives an access token anyway — a book queued at 4pm may
still be draining at 6pm, long after a captured token expired.

These tests pin the two properties that keep that from being a hole: the secret
must be configured to match anything at all, and a worker call must still name
the user it is acting for.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Request

from auth import _worker_user


def _request(headers: dict[str, str] | None = None) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": "POST", "path": "/api/x", "headers": raw})


def test_worker_secret_authenticates_and_names_the_user(monkeypatch):
    monkeypatch.setenv("WORKER_SHARED_SECRET", "s3cret")
    user = _worker_user(_request({"X-PromptMaster-User": "user-123"}), "s3cret")
    assert user is not None
    assert user.id == "user-123"
    assert user.role == "worker"


def test_unset_secret_never_matches(monkeypatch):
    """The dangerous case: an empty env var matching an empty or absent header."""
    monkeypatch.delenv("WORKER_SHARED_SECRET", raising=False)
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "") is None
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "anything") is None

    monkeypatch.setenv("WORKER_SHARED_SECRET", "   ")
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "") is None


def test_wrong_secret_falls_through_to_jwt_verification(monkeypatch):
    """None means 'not a worker', so the caller goes on to decode it as a token."""
    monkeypatch.setenv("WORKER_SHARED_SECRET", "s3cret")
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "not-the-secret") is None


def test_worker_must_name_a_user(monkeypatch):
    """Anonymous machine calls are refused: FR-18 has to meter cost per user."""
    monkeypatch.setenv("WORKER_SHARED_SECRET", "s3cret")
    with pytest.raises(HTTPException) as exc:
        _worker_user(_request(), "s3cret")
    assert exc.value.status_code == 401

    with pytest.raises(HTTPException):
        _worker_user(_request({"X-PromptMaster-User": "   "}), "s3cret")


def test_non_ascii_token_is_rejected_not_a_crash(monkeypatch):
    """A hostile bearer token must produce a 401, never a 500.

    hmac.compare_digest raises TypeError when handed a str containing non-ASCII,
    so comparing the raw strings turned a token with a single accented character
    into an unhandled server error — a trivially reachable way to make the API
    fail loudly. The comparison is done on bytes for that reason.
    """
    monkeypatch.setenv("WORKER_SHARED_SECRET", "s3cret")
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "café-token") is None
    assert _worker_user(_request({"X-PromptMaster-User": "u"}), "‮secret") is None
