"""Supabase JWT verification.

Hermetic: an EC keypair is generated in-process and the JWKS client is stubbed,
so nothing here touches the network (matching the no-network rule the rest of
the suite follows).

These are the FR-17 evidence for the "authenticated API" half of the
requirement — RLS policies only cover the Supabase half.
"""

from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import auth as auth_mod
from auth import require_user
from main import app

ISSUER_URL = "https://proj.supabase.co"
ISSUER = f"{ISSUER_URL}/auth/v1"
OTHER_ISSUER = "https://someone-elses-project.supabase.co/auth/v1"
KID = "test-key-1"


@pytest.fixture
def keypair():
    priv = ec.generate_private_key(ec.SECP256R1())
    return priv, priv.public_key()


@pytest.fixture
def auth_live(monkeypatch, keypair):
    """Exercise the real dependency instead of conftest's autouse bypass."""
    app.dependency_overrides.pop(require_user, None)
    monkeypatch.setenv("SUPABASE_URL", ISSUER_URL)
    monkeypatch.setenv("AUTH_ENFORCED", "true")

    _priv, pub = keypair

    class _Key:
        key = pub

    class _StubJWKClient:
        def get_signing_key_from_jwt(self, _token):
            return _Key()

    monkeypatch.setattr(auth_mod, "_jwk_client", lambda _url: _StubJWKClient())
    return TestClient(app, raise_server_exceptions=False)


def make_token(priv, *, aud="authenticated", iss=ISSUER, exp_delta=3600, alg="ES256", sub="user-1"):
    now = int(time.time())
    return jwt.encode(
        {"sub": sub, "aud": aud, "iss": iss, "exp": now + exp_delta, "iat": now, "email": "a@b.c"},
        priv,
        algorithm=alg,
        headers={"kid": KID},
    )


PROBE = "/api/build-prompt"
PROBE_BODY = {
    "inputs": {
        "objective": "Plan a launch.",
        "audience": "Engineers",
        "constraints": "",
        "output_format": "",
        "mode": "architect",
    }
}


def _post(client, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(PROBE, json=PROBE_BODY, headers=headers)


# --- the happy path ---------------------------------------------------------


def test_valid_token_is_accepted(auth_live, keypair):
    priv, _ = keypair
    assert _post(auth_live, make_token(priv)).status_code == 200


# --- rejections that each correspond to a real attack -----------------------


def test_missing_token_is_rejected_with_a_challenge(auth_live):
    res = _post(auth_live)
    assert res.status_code == 401
    # Lets the client tell "no token" apart from "bad token".
    assert res.headers.get("WWW-Authenticate") == "Bearer"


def test_expired_token_is_rejected(auth_live, keypair):
    priv, _ = keypair
    assert _post(auth_live, make_token(priv, exp_delta=-60)).status_code == 401


def test_token_from_another_supabase_project_is_rejected(auth_live, keypair):
    """Without issuer validation this would pass — a cross-tenant break."""
    priv, _ = keypair
    assert _post(auth_live, make_token(priv, iss=OTHER_ISSUER)).status_code == 401


def test_wrong_audience_is_rejected(auth_live, keypair):
    """Blocks anon-role tokens and tokens minted for another Supabase surface."""
    priv, _ = keypair
    assert _post(auth_live, make_token(priv, aud="anon")).status_code == 401


def test_alg_none_is_rejected(auth_live):
    unsigned = jwt.encode(
        {"sub": "u", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        key="",
        algorithm="none",
    )
    assert _post(auth_live, unsigned).status_code == 401


def test_algorithm_confusion_is_rejected(auth_live, monkeypatch):
    """An HS256 token must not be accepted while the project signs asymmetrically."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    forged = jwt.encode(
        {"sub": "u", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        "x" * 40,  # length only, to avoid an unrelated key-strength warning
        algorithm="HS256",
    )
    assert _post(auth_live, forged).status_code == 401


def test_token_signed_by_the_wrong_key_is_rejected(auth_live):
    other = ec.generate_private_key(ec.SECP256R1())
    assert _post(auth_live, make_token(other)).status_code == 401


def test_malformed_token_is_rejected(auth_live):
    assert _post(auth_live, "not-a-jwt").status_code == 401


# --- staged rollout ---------------------------------------------------------


def test_unenforced_mode_allows_an_unauthenticated_request(auth_live, monkeypatch):
    """The window where the backend is deployed but the frontend isn't yet."""
    monkeypatch.setenv("AUTH_ENFORCED", "false")
    assert _post(auth_live).status_code == 200


def test_unenforced_mode_still_rejects_an_invalid_token(auth_live, monkeypatch):
    """A broken client should fail loudly, not silently degrade to anonymous."""
    monkeypatch.setenv("AUTH_ENFORCED", "false")
    assert _post(auth_live, "not-a-jwt").status_code == 401


# --- coverage: the guard that stops a future router shipping unprotected ----


def _has_require_user(route) -> bool:
    stack = list(getattr(getattr(route, "dependant", None), "dependencies", []) or [])
    while stack:
        dep = stack.pop()
        if getattr(dep, "call", None) is require_user:
            return True
        stack.extend(dep.dependencies or [])
    return False


PUBLIC_PATHS = {"/api/health", "/api/modes"}


def test_every_money_spending_route_requires_auth():
    unprotected = [
        r.path
        for r in app.routes
        if getattr(r, "path", "").startswith("/api/")
        and r.path not in PUBLIC_PATHS
        and not _has_require_user(r)
    ]
    assert not unprotected, f"these /api routes are unauthenticated: {unprotected}"


def test_health_and_modes_stay_public():
    for r in app.routes:
        if getattr(r, "path", "") in PUBLIC_PATHS:
            assert not _has_require_user(r), f"{r.path} should stay public"


def test_models_is_protected_even_though_its_router_is_public():
    """/api/models proxies OpenRouter with our key on every call."""
    route = next(r for r in app.routes if getattr(r, "path", "") == "/api/models")
    assert _has_require_user(route)
