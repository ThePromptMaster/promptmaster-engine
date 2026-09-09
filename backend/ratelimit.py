"""FR-18: per-user rate limiting for a controlled beta.

**The awkward question first: this backend is stateless, so where does the
counter live?**

Three options were on the table.

1. *A Supabase-backed counter.* Durable, correct across instances — and
   forbidden. `CLAUDE.md` states the load-bearing invariant plainly: the backend
   owns no user data, has no Supabase data client, and no session store. That is
   not a stylistic preference; it is what makes "the backend is a stateless but
   authenticated proxy" checkable. It would also put a database round-trip in
   front of every generation call, on the request path, to prevent a thing that
   has never happened in a beta with a handful of users.

2. *Redis or a platform rate-limit product.* A new piece of infrastructure, a
   new credential, and a new failure mode, provisioned for a demo tomorrow.

3. *An in-process sliding window.* What this is.

**What it actually buys, stated honestly.** A warm serverless instance handles a
user's consecutive requests, so an in-process window reliably catches the threat
that exists in a controlled beta: a runaway client loop, a retry storm, a
mis-wired `useEffect` firing generation on every render. It is a burst limiter
and a circuit breaker, not a billing quota.

**What it does not buy, equally honestly.** Under fan-out to N cold instances a
determined caller gets up to N windows. It is therefore not the thing standing
between the OpenRouter key and an unbounded bill. *That* job belongs to three
other controls, and this module is deliberately not asked to do it:

  - the spend cap set on the OpenRouter account itself, which is the only hard
    ceiling that exists and is enforced by the party taking the payment;
  - the generation-size caps in `promptmaster/limits.py`, which bound what any
    single request can cost regardless of how many get through;
  - the persisted `model_usage` rows and the admin page over them, which make
    an anomaly *visible* — FR-19's half of the same requirement.

Rate limiting alone has never been a cost control. Rate limiting plus a
provider-side cap plus visibility is one, and that is what got built.

**Why not fail closed on the counter?** Because the counter is memory. There is
no state to lose and nothing to be unavailable, so there is no fail-open hole
here — the limiter either has seen your recent requests or it is a fresh
instance that has seen nothing, and a fresh instance is exactly the case option
1 would have paid a round-trip per request to catch.
"""

from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request

from auth import AuthUser, require_user
from observability import set_user

logger = logging.getLogger(__name__)


def _int_env(name: str, default: int) -> int:
    """Read per-call, not at import, so limits are tunable without a redeploy."""
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("rate_limit_env_invalid", extra={"var": name, "value": raw})
        return default
    return value if value >= 0 else default


def limits_enabled() -> bool:
    return os.getenv("RATE_LIMIT_ENABLED", "true").strip().lower() not in ("false", "0", "no")


#: A person clicking through the workspace generates a handful of calls a
#: minute; a long-form run is paced by the drain, not by the user. Sixty is
#: comfortably above deliberate use and far below a loop.
DEFAULT_PER_MINUTE = 60
#: The hour window is the one that catches a slow leak — a client retrying
#: every two seconds stays under the minute limit indefinitely.
DEFAULT_PER_HOUR = 600

#: The drain legitimately bursts on one user's behalf while draining their book,
#: and it is a trusted machine identity that already holds the service-role key.
#: It gets headroom rather than an exemption: a drain stuck in a loop is exactly
#: the runaway worth catching, and exempting it would remove the only control on
#: the code path that spends the most money.
WORKER_MULTIPLIER = 5


class SlidingWindowLimiter:
    """Per-key request timestamps, trimmed on read.

    A deque per key rather than a fixed counter per calendar minute, because a
    fixed window lets a caller spend the whole allowance at 11:59:59 and the
    whole next allowance at 12:00:00 — twice the intended rate at exactly the
    moment a runaway loop produces it.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: float, now: float) -> float | None:
        """Record a hit and return seconds-to-wait if the limit is exceeded.

        Returns None when the request is allowed. When it is refused, the hit is
        *not* recorded — otherwise a client hammering a closed door keeps
        pushing its own window forward and can never recover.
        """
        if limit <= 0:
            return None

        hits = self._hits[key]
        cutoff = now - window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()

        if len(hits) >= limit:
            return max(0.0, (hits[0] + window_seconds) - now)

        hits.append(now)
        return None

    def reset(self) -> None:
        self._hits.clear()

    def observed_keys(self) -> int:
        return len(self._hits)

    def prune(self, now: float, window_seconds: float) -> None:
        """Drop keys with no recent activity, so memory tracks active users.

        Without this a long-lived instance accumulates one deque per user id it
        has ever seen. Cheap, and called on the same path that already walks the
        window.
        """
        cutoff = now - window_seconds
        stale = [k for k, hits in self._hits.items() if not hits or hits[-1] <= cutoff]
        for key in stale:
            del self._hits[key]


_limiter = SlidingWindowLimiter()
_last_prune = 0.0
_PRUNE_INTERVAL = 300.0


def limiter() -> SlidingWindowLimiter:
    return _limiter


def reset_limiter() -> None:
    """Test hook. The suite shares one process and one test user id."""
    global _last_prune
    _limiter.reset()
    _last_prune = 0.0


def rate_limit_detail(retry_after: float) -> dict:
    """The FR-16 detail shape, so a 429 reads like every other classified error.

    Deliberately reuses the existing `rate_limited` code rather than minting a
    new one. The client's recovery affordances for "slow down and try again" —
    retry, pause, technical details — are already exactly right for this, and a
    tenth code would mean touching `ACTIONS_FOR` and the `ErrorCode` union to
    arrive at the same three buttons. The distinction that matters is for
    operators, not users, and it lives in the log line's `event` field: a
    `rate_limited_local` line is us, a provider 429 is OpenRouter.
    """
    wait = max(1, int(round(retry_after)))
    return {
        "code": "rate_limited",
        "title": "Too many requests, too quickly",
        "message": (
            f"This account has hit the beta's request limit. Waiting about {wait}s "
            "and trying again will clear it. Nothing was lost — this request was "
            "refused before it reached the model, so nothing was generated or charged."
        ),
        "retryable": True,
        "retry_after": float(wait),
        "provider_status": None,
        "detail": f"Rate limited: retry after {wait}s",
    }


async def enforce_rate_limit(
    request: Request,
    user: AuthUser | None = Depends(require_user),
) -> AuthUser | None:
    """Router-level dependency. Wired in `main.py` beside `require_user`.

    Depends on `require_user` rather than re-deriving identity, which means the
    test suite's single auth override covers this too, and — more importantly —
    that a route cannot be limited without also being authenticated. An
    unauthenticated rate limit would have to key on IP, and every serverless
    caller shares a small pool of egress addresses.

    This is also the point where the authenticated id reaches the log context,
    so every line emitted while serving the request carries the user.
    """
    if user is not None:
        set_user(user.id)

    if user is None or not limits_enabled():
        return user

    global _last_prune
    now = time.monotonic()
    multiplier = WORKER_MULTIPLIER if user.role == "worker" else 1
    per_minute = _int_env("RATE_LIMIT_PER_MINUTE", DEFAULT_PER_MINUTE) * multiplier
    per_hour = _int_env("RATE_LIMIT_PER_HOUR", DEFAULT_PER_HOUR) * multiplier

    if now - _last_prune > _PRUNE_INTERVAL:
        _limiter.prune(now, 3600.0)
        _last_prune = now

    # The minute window is checked first so a burst reports the short wait it
    # actually needs, rather than the hour window's much longer one.
    for suffix, limit, window in (
        ("m", per_minute, 60.0),
        ("h", per_hour, 3600.0),
    ):
        retry_after = _limiter.check(f"{user.id}:{suffix}", limit, window, now)
        if retry_after is not None:
            logger.warning(
                "rate_limited_local",
                extra={
                    "event": "rate_limited_local",
                    "window": suffix,
                    "limit": limit,
                    "retry_after_s": round(retry_after, 1),
                    "role": user.role,
                },
            )
            raise HTTPException(
                status_code=429,
                detail=rate_limit_detail(retry_after),
                headers={"Retry-After": str(max(1, int(round(retry_after))))},
            )

    return user
