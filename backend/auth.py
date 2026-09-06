"""Supabase JWT verification.

Until now every /api/* route was unauthenticated, protected only by CORS —
which is trivially bypassed by any non-browser client. That made the service an
open proxy against the OpenRouter key: anyone who read NEXT_PUBLIC_API_URL out
of the shipped JS bundle could spend money. This closes that, and is also the
prerequisite for per-user rate limiting (FR-18) and job ownership.

The backend still owns no user data. It verifies identity and nothing more —
no Supabase data client, no persistence. "Stateless proxy" becomes "stateless
but authenticated".
"""

from __future__ import annotations

import hmac
import logging
import os
from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

# Bearer token is optional at the parser level so we can control the error
# shape ourselves and support the staged rollout below.
_bearer = HTTPBearer(auto_error=False)

_UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": "Bearer"}


@dataclass(frozen=True)
class AuthUser:
    """The authenticated caller. `id` is the Supabase auth.users id."""

    id: str
    email: str | None
    role: str


def auth_enforced() -> bool:
    """Whether a missing token is rejected.

    Read per-call, not at import, so it can be flipped with an env change and
    no redeploy. The rollout is: ship the backend with AUTH_ENFORCED=false
    (verify when present, never reject), deploy the frontend's token
    attachment, watch the unauthenticated counter reach zero, then flip. The
    frontend and backend are separate deploy units, so doing this in one step
    takes the app down whichever way it lands.
    """
    return os.getenv("AUTH_ENFORCED", "true").strip().lower() not in ("false", "0", "no")


def _supabase_url() -> str:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not url:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL is not configured; cannot verify tokens.",
        )
    return url


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> jwt.PyJWKClient:
    # Cached across requests: the signing keys rotate rarely and refetching per
    # request would add a network round-trip to every API call.
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600)


def decode_token(token: str) -> dict:
    """Verify a Supabase access token and return its claims.

    Dispatches on the header's `alg` because Supabase is mid-transition:
    newer projects sign asymmetrically (ES256/RS256) with a rotating JWKS,
    older ones still use the shared HS256 secret. Hardcoding either one breaks
    the day the project is migrated or the key is rotated.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"Malformed token: {exc}", headers=_UNAUTHENTICATED_HEADERS)

    alg = str(header.get("alg", ""))
    url = _supabase_url()

    if alg.startswith("HS"):
        secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
        if not secret:
            raise HTTPException(
                401,
                "Token is HS-signed but SUPABASE_JWT_SECRET is not configured.",
                headers=_UNAUTHENTICATED_HEADERS,
            )
        key: object = secret
        algorithms = ["HS256"]
    elif alg in ("ES256", "RS256"):
        try:
            key = _jwk_client(f"{url}/auth/v1/.well-known/jwks.json").get_signing_key_from_jwt(token).key
        except jwt.PyJWTError as exc:
            raise HTTPException(401, f"Could not resolve signing key: {exc}", headers=_UNAUTHENTICATED_HEADERS)
    else:
        # Explicitly refuse anything we did not plan for, `alg: none` included.
        raise HTTPException(401, f"Unsupported token algorithm: {alg!r}", headers=_UNAUTHENTICATED_HEADERS)

    if alg in ("ES256", "RS256"):
        algorithms = [alg]

    try:
        return jwt.decode(
            token,
            key,
            # Never trust the header's alg — pinning the accepted list is what
            # blocks `alg: none` and the RS->HS key-confusion attack.
            algorithms=algorithms,
            audience="authenticated",
            # Without issuer, a token minted by ANY other Supabase project
            # validates here. That would be a cross-tenant break of FR-17.
            issuer=f"{url}/auth/v1",
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token has expired.", headers=_UNAUTHENTICATED_HEADERS)
    except jwt.InvalidAudienceError:
        raise HTTPException(401, "Token audience is not 'authenticated'.", headers=_UNAUTHENTICATED_HEADERS)
    except jwt.InvalidIssuerError:
        raise HTTPException(401, "Token was issued by a different project.", headers=_UNAUTHENTICATED_HEADERS)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, f"Invalid token: {exc}", headers=_UNAUTHENTICATED_HEADERS)


def _worker_secret() -> str:
    """Shared secret the job drain presents instead of a user token.

    The drain is a Next.js route handler holding the service-role key. It calls
    this API for generation only, and under Vercel Cron there is no user in the
    request at all — so there is no Supabase access token to forward. Nor can it
    present the service-role key: that is signed for `role: service_role` with no
    `sub` and a different issuer, so decode_token rejects it, and on projects
    using the newer publishable/secret keys it is not a JWT at all.

    A job also outlives a token. Access tokens expire in an hour; a ten-section
    book queued at 4pm may still be draining at 6pm, so capturing the user's
    token at enqueue time and replaying it would fail exactly when resumption
    matters most.

    This is a machine identity, not an escalation. The drain already holds the
    service-role key, so it can already read and write any row; letting it name
    the user it is working on behalf of grants it nothing it did not have. What
    it buys is that the backend still knows WHO each generation call is for,
    which is what FR-18's per-user cost controls will meter on.
    """
    return os.getenv("WORKER_SHARED_SECRET", "").strip()


def _worker_user(request: Request, token: str) -> AuthUser | None:
    """Return the impersonated user when `token` is the worker secret, else None."""
    secret = _worker_secret()
    # An unset secret must never match an empty or absent header.
    #
    # Compared as bytes, not str: compare_digest raises TypeError on a str
    # holding non-ASCII, so a bearer token with a single accented character
    # would surface as a 500 rather than the 401 it is.
    if not secret or not hmac.compare_digest(token.encode("utf-8"), secret.encode("utf-8")):
        return None

    user_id = request.headers.get("X-PromptMaster-User", "").strip()
    if not user_id:
        raise HTTPException(
            401,
            "Worker credential accepted but no X-PromptMaster-User was supplied.",
            headers=_UNAUTHENTICATED_HEADERS,
        )
    return AuthUser(id=user_id, email=None, role="worker")


def _to_user(claims: dict) -> AuthUser:
    return AuthUser(
        id=str(claims.get("sub", "")),
        email=claims.get("email"),
        role=str(claims.get("role", "authenticated")),
    )


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser | None:
    """Verify a token if one is present; return None if not.

    Never raises for a *missing* token. An invalid one still raises, so a
    broken client fails loudly rather than silently degrading to anonymous.
    """
    if credentials is None or not credentials.credentials:
        return None
    worker = _worker_user(request, credentials.credentials)
    user = worker or _to_user(decode_token(credentials.credentials))
    request.state.user = user
    return user


async def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthUser | None:
    """Require an authenticated caller, unless the rollout flag is off."""
    if credentials is None or not credentials.credentials:
        if auth_enforced():
            raise HTTPException(
                401,
                "Authentication required.",
                headers=_UNAUTHENTICATED_HEADERS,
            )
        # Rollout window: count these so we can see when the frontend has
        # finished shipping tokens and it is safe to flip the flag.
        logger.warning(
            "UNAUTHENTICATED_REQUEST path=%s (AUTH_ENFORCED=false)",
            request.url.path,
        )
        return None

    worker = _worker_user(request, credentials.credentials)
    user = worker or _to_user(decode_token(credentials.credentials))
    request.state.user = user
    return user
