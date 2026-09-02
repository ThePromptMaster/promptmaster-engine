"""Per-call timeouts and the wall-clock deadline.

Before this, `timeout` was bound to the httpx.AsyncClient at construction and
defaulted to 120s — above Vercel's 60s function limit, so it could never fire
before the platform killed the request and the caller just saw an opaque 504.
Worse, the retry ladder could burn three request timeouts plus 4.5s of sleep,
and generate_json makes a second (repair) call on top of that.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock

import httpx
import pytest

from promptmaster.llm_client import (
    DEFAULT_TIMEOUT,
    OpenRouterClient,
    OpenRouterDeadlineError,
    OpenRouterError,
)


@pytest.fixture
def client() -> OpenRouterClient:
    return OpenRouterClient(api_key="test-key")


def _ok_response() -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "hi"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2},
        },
        request=httpx.Request("POST", "https://openrouter.ai"),
    )


def test_default_timeout_fits_inside_a_serverless_function():
    assert DEFAULT_TIMEOUT < 60, "must fire before the platform kills the request"
    assert OpenRouterClient(api_key="k").timeout == DEFAULT_TIMEOUT


def test_the_shared_http_client_imposes_no_ceiling(client):
    # A client-level timeout would silently cap every per-call value.
    assert client._client.timeout.read is None


@pytest.mark.asyncio
async def test_per_call_timeout_is_passed_to_the_request(client, monkeypatch):
    post = AsyncMock(return_value=_ok_response())
    monkeypatch.setattr(client._client, "post", post)

    await client.generate(prompt="p", timeout=12.5)

    assert post.await_args.kwargs["timeout"] == 12.5


@pytest.mark.asyncio
async def test_instance_timeout_is_the_default_when_no_call_timeout(client, monkeypatch):
    post = AsyncMock(return_value=_ok_response())
    monkeypatch.setattr(client._client, "post", post)

    await client.generate(prompt="p")

    assert post.await_args.kwargs["timeout"] == DEFAULT_TIMEOUT


@pytest.mark.asyncio
async def test_a_call_is_clamped_to_the_remaining_budget(client, monkeypatch):
    post = AsyncMock(return_value=_ok_response())
    monkeypatch.setattr(client._client, "post", post)

    await client.generate(prompt="p", timeout=50.0, deadline=time.monotonic() + 3.0)

    # 50s would overrun a 3s budget.
    assert post.await_args.kwargs["timeout"] <= 3.0


@pytest.mark.asyncio
async def test_an_elapsed_deadline_fails_fast_without_calling_the_api(client, monkeypatch):
    post = AsyncMock(return_value=_ok_response())
    monkeypatch.setattr(client._client, "post", post)

    with pytest.raises(OpenRouterDeadlineError):
        await client.generate(prompt="p", deadline=time.monotonic() - 1)

    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_backoff_does_not_sleep_past_the_deadline(client, monkeypatch):
    """The failure mode this exists to prevent: sleeping into a 504."""
    post = AsyncMock(side_effect=httpx.TimeoutException("boom"))
    monkeypatch.setattr(client._client, "post", post)

    started = time.monotonic()
    with pytest.raises(OpenRouterDeadlineError):
        # First attempt fails, backoff is 1.5s, budget is 0.2s.
        await client.generate(prompt="p", timeout=0.1, deadline=time.monotonic() + 0.2)

    assert time.monotonic() - started < 1.5, "should not have slept the full backoff"
    assert post.await_count == 1, "should not retry when the budget is spent"


@pytest.mark.asyncio
async def test_retries_normally_when_there_is_budget(client, monkeypatch):
    post = AsyncMock(side_effect=[httpx.TimeoutException("boom"), _ok_response()])
    monkeypatch.setattr(client._client, "post", post)

    content, _usage = await client.generate(prompt="p", timeout=1.0)

    assert content == "hi"
    assert post.await_count == 2


@pytest.mark.asyncio
async def test_a_deadline_error_is_not_masked_as_a_json_parse_failure(client, monkeypatch):
    """The drain must tell 're-queue me' apart from 'the model returned garbage'."""

    async def slow_bad_json(*_args, **_kwargs):
        # Consume the budget, so the repair pass has none left.
        await asyncio.sleep(0.08)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "not json"}, "finish_reason": "stop"}],
                "usage": {},
            },
            request=httpx.Request("POST", "https://openrouter.ai"),
        )

    post = AsyncMock(side_effect=slow_bad_json)
    monkeypatch.setattr(client._client, "post", post)

    with pytest.raises(OpenRouterDeadlineError):
        await client.generate_json(prompt="p", deadline=time.monotonic() + 0.05)

    # The first call happened; the repair was refused for want of budget.
    assert post.await_count == 1


@pytest.mark.asyncio
async def test_a_genuine_parse_failure_is_still_an_openrouter_error(client, monkeypatch):
    post = AsyncMock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "not json"}, "finish_reason": "stop"}],
                "usage": {},
            },
            request=httpx.Request("POST", "https://openrouter.ai"),
        )
    )
    monkeypatch.setattr(client._client, "post", post)

    with pytest.raises(OpenRouterError) as exc:
        await client.generate_json(prompt="p")
    assert not isinstance(exc.value, OpenRouterDeadlineError)


def test_deadline_error_is_catchable_as_an_openrouter_error():
    # Existing `except OpenRouterError` handlers must keep working.
    assert issubclass(OpenRouterDeadlineError, OpenRouterError)
