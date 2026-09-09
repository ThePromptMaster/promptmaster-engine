"""FR-18: the rate limit has to actually refuse.

The point of these tests is that the limiter is load-bearing rather than
decorative. The first one is the one that matters: past the limit, the API
returns 429 and the request never reaches a handler. Everything else here
guards a way that guarantee could be quietly lost — a shared counter across
users, a refusal that keeps pushing the window forward so the caller can never
recover, a 429 body that the client cannot render.

`/api/estimate-job` is the endpoint under test throughout because it is
protected, cheap, and makes no LLM call, so a test that spends a hundred
requests on it is testing the limiter and nothing else.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import ratelimit
from main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def tight_limit(monkeypatch):
    """Three a minute. Small enough to exhaust, large enough to see it allow."""
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "3")
    monkeypatch.setenv("RATE_LIMIT_PER_HOUR", "1000")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    ratelimit.reset_limiter()
    yield
    ratelimit.reset_limiter()


BODY = {"section_count": 3, "model": "openai/gpt-4o-mini"}


def test_requests_under_the_limit_are_served(client, tight_limit):
    for _ in range(3):
        assert client.post("/api/estimate-job", json=BODY).status_code == 200


def test_the_limit_refuses(client, tight_limit):
    """The whole requirement, in one assertion."""
    for _ in range(3):
        assert client.post("/api/estimate-job", json=BODY).status_code == 200

    refused = client.post("/api/estimate-job", json=BODY)
    assert refused.status_code == 429


def test_refusal_carries_the_fr16_detail_shape(client, tight_limit):
    """A 429 the client cannot render is a 429 that shows "API error: 429"."""
    for _ in range(3):
        client.post("/api/estimate-job", json=BODY)
    detail = client.post("/api/estimate-job", json=BODY).json()["detail"]

    assert detail["code"] == "rate_limited"
    assert detail["retryable"] is True
    assert detail["retry_after"] > 0
    # FR-16's rule: every message says what was preserved.
    assert "nothing was lost" in detail["message"].lower()


def test_refusal_sets_retry_after_header(client, tight_limit):
    for _ in range(3):
        client.post("/api/estimate-job", json=BODY)
    refused = client.post("/api/estimate-job", json=BODY)

    assert refused.status_code == 429
    assert int(refused.headers["Retry-After"]) >= 1


def test_refused_requests_do_not_extend_the_window():
    """A caller hammering a closed door must still recover when the window rolls.

    If a refused request recorded a hit, the oldest timestamp would keep being
    replaced and the window would never drain — the user would be locked out
    for as long as they kept retrying, which is precisely what a client with an
    automatic retry does.
    """
    limiter = ratelimit.SlidingWindowLimiter()
    now = 1000.0

    for _ in range(2):
        assert limiter.check("u", 2, 60.0, now) is None
    # Ten refusals over the next 50 seconds.
    for offset in range(1, 51, 5):
        assert limiter.check("u", 2, 60.0, now + offset) is not None

    # 61s after the first hit, the window has drained despite the hammering.
    assert limiter.check("u", 2, 60.0, now + 61) is None


def test_limits_are_per_user_not_global(client, tight_limit, monkeypatch):
    """One user exhausting their budget must not lock out everyone else."""
    from auth import AuthUser, require_user

    def as_user(user_id: str):
        app.dependency_overrides[require_user] = lambda: AuthUser(
            id=user_id, email=None, role="authenticated"
        )

    as_user("user-a")
    for _ in range(3):
        client.post("/api/estimate-job", json=BODY)
    assert client.post("/api/estimate-job", json=BODY).status_code == 429

    as_user("user-b")
    assert client.post("/api/estimate-job", json=BODY).status_code == 200


def test_the_drain_gets_headroom_but_not_an_exemption(tight_limit):
    """The worker identity is trusted, not unlimited.

    A drain stuck in a loop is the runaway that spends the most money, so it is
    metered like anything else — just with a multiplier that accommodates a
    legitimate burst while drafting.
    """
    assert ratelimit.WORKER_MULTIPLIER > 1

    limiter = ratelimit.SlidingWindowLimiter()
    worker_budget = 3 * ratelimit.WORKER_MULTIPLIER
    for _ in range(worker_budget):
        assert limiter.check("w", worker_budget, 60.0, 1000.0) is None
    assert limiter.check("w", worker_budget, 60.0, 1000.0) is not None


def test_the_hour_window_catches_a_slow_leak():
    """Under the minute limit forever is still an unbounded spend."""
    limiter = ratelimit.SlidingWindowLimiter()
    now = 1000.0
    # Two a minute for fifty minutes: never trips a 3/minute limit.
    for i in range(100):
        result = limiter.check("u:h", 100, 3600.0, now + i * 30)
        assert result is None, f"stopped early at {i}"
    assert limiter.check("u:h", 100, 3600.0, now + 100 * 30) is not None


def test_limiter_can_be_switched_off(client, monkeypatch):
    """The kill switch is env-only and read per call, so it needs no redeploy."""
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    ratelimit.reset_limiter()

    for _ in range(5):
        assert client.post("/api/estimate-job", json=BODY).status_code == 200


def test_invalid_limit_env_falls_back_to_the_default(monkeypatch):
    """A typo in an env var must not mean "no limit" or "limit of zero"."""
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "not-a-number")
    assert ratelimit._int_env("RATE_LIMIT_PER_MINUTE", 60) == 60
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "-5")
    assert ratelimit._int_env("RATE_LIMIT_PER_MINUTE", 60) == 60


def test_prune_drops_inactive_keys():
    """Memory tracks active users, not every id the instance has ever seen."""
    limiter = ratelimit.SlidingWindowLimiter()
    limiter.check("old", 10, 60.0, 1000.0)
    limiter.check("new", 10, 60.0, 5000.0)
    limiter.prune(now=5000.0, window_seconds=3600.0)

    assert limiter.observed_keys() == 1
