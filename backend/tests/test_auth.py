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


PUBLIC_PATHS = {"/api/health", "/api/modes"}


def _api_operations() -> list[tuple[str, str]]:
    """Every (method, path) the app serves under /api, from its OpenAPI schema.

    Deliberately not a walk of `app.routes`: from FastAPI 0.141 an included
    router appears there as one opaque `_IncludedRouter`, and a walk that
    stepped over it found no routes to check — so the coverage test below
    passed while checking nothing. The schema is public API; `app.routes`'
    shape is not.
    """
    ops = []
    for path, methods in app.openapi()["paths"].items():
        if not path.startswith("/api/"):
            continue
        concrete = path.replace("{", "").replace("}", "")
        for method in methods:
            ops.append((method.upper(), concrete))
    return ops


def test_route_discovery_is_not_vacuous():
    """If discovery silently finds nothing, every check below passes."""
    paths = {path for _method, path in _api_operations()}
    assert {"/api/build-prompt", "/api/generate-stage-artifact", "/api/models"} <= paths
    assert PUBLIC_PATHS <= paths


def test_every_money_spending_route_requires_auth(auth_live):
    unprotected = [
        f"{method} {path} -> {status}"
        for method, path in _api_operations()
        if path not in PUBLIC_PATHS
        and (status := auth_live.request(method, path, json={}).status_code) != 401
    ]
    assert not unprotected, f"these /api routes answer without a token: {unprotected}"


def test_health_and_modes_stay_public(auth_live):
    for path in PUBLIC_PATHS:
        assert auth_live.get(path).status_code == 200, f"{path} should stay public"


def test_models_is_protected_even_though_its_router_is_public(auth_live):
    """/api/models proxies OpenRouter with our key on every call."""
    assert auth_live.get("/api/models").status_code == 401
