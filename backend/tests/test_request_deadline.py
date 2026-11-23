"""A request stops before the platform's limit and says so (L-276).

22 Nov, Sean, Migration Week Operating Packet: "Change it → Whole document →
Draft revision" hit Vercel's 300-second limit on every attempt. The Opus call
reasoned for 181 s and answered nothing, the "more room" retry was killed by
the platform, and the browser, getting a 504 page with no CORS headers, said
the connection had dropped, twice.
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from observability import DEFAULT_REQUEST_BUDGET_SECONDS, request_budget_seconds, request_deadline_var
from promptmaster.errors import FUNCTION_TIMEOUT, OUT_OF_TIME, classify_error
from promptmaster.llm_client import OpenRouterClient, OpenRouterDeadlineError, RequestDeadline, request_deadline


def _empty_at_length(request):
    return httpx.Response(200, json={"choices": [{"message": {"content": ""}, "finish_reason": "length"}], "usage": {}})


async def test_a_call_that_hangs_stops_at_the_request_deadline():
    """OpenRouter keeps a slow call's connection alive, so httpx's per-read timeout never fires."""
    client = OpenRouterClient(api_key="k")

    async def hang(*_a, **_k):
        await asyncio.sleep(5)

    client._on_a_key_with_credit = hang  # type: ignore[method-assign]
    token = request_deadline_var.set(time.monotonic() + 0.2)
    try:
        started = time.monotonic()
        with pytest.raises(OpenRouterDeadlineError) as raised:
            await client.generate("hi", model="anthropic/claude-opus-5.5")
        assert time.monotonic() - started < 2
        assert raised.value.request_limit is True
    finally:
        request_deadline_var.reset(token)


async def test_the_more_room_retry_is_not_sent_when_it_cannot_finish():
    """Sean's case: the empty reply took 181 s, and the retry asks for twice the tokens."""
    calls = []

    async def handler(request):
        calls.append(1)
        await asyncio.sleep(0.15)
        return _empty_at_length(request)

    client = OpenRouterClient(api_key="k")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    token = request_deadline_var.set(time.monotonic() + 0.25)
    try:
        with pytest.raises(OpenRouterDeadlineError, match="Out of time after an empty reply") as raised:
            await client.generate("hi", model="anthropic/claude-opus-5.5", max_tokens=1000)
        assert raised.value.request_limit is True
    finally:
        request_deadline_var.reset(token)
    assert len(calls) == 1


async def test_with_time_to_spare_the_more_room_retry_is_still_sent():
    sent = []

    def handler(request):
        sent.append(1)
        if len(sent) == 1:
            return _empty_at_length(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "done"}, "finish_reason": "stop"}], "usage": {}})

    client = OpenRouterClient(api_key="k")
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    token = request_deadline_var.set(time.monotonic() + 60)
    try:
        content, _usage = await client.generate("hi", model="anthropic/claude-opus-5.5", max_tokens=1000)
    finally:
        request_deadline_var.reset(token)
    assert content == "done"
    assert len(sent) == 2


def test_a_request_timeout_is_told_as_one_a_jobs_as_before():
    told = classify_error(OpenRouterDeadlineError("x", request_limit=True))
    assert told.code == OUT_OF_TIME
    assert "ran out of time on this request" in told.message
    assert "Nothing was changed" in told.message
    assert f"about {round(DEFAULT_REQUEST_BUDGET_SECONDS / 60)} minutes" in told.message
    # The job drain's own budget still reads as a pause it picks up from.
    assert classify_error(OpenRouterDeadlineError("x")).code == FUNCTION_TIMEOUT


def test_the_budget_is_read_per_call_and_falls_back_when_unset_or_wrong(monkeypatch):
    monkeypatch.delenv("REQUEST_BUDGET_SECONDS", raising=False)
    assert request_budget_seconds() == DEFAULT_REQUEST_BUDGET_SECONDS
    monkeypatch.setenv("REQUEST_BUDGET_SECONDS", "280")
    assert request_budget_seconds() == 280
    monkeypatch.setenv("REQUEST_BUDGET_SECONDS", "soon")
    assert request_budget_seconds() == DEFAULT_REQUEST_BUDGET_SECONDS


def test_outside_a_request_there_is_no_deadline():
    assert request_deadline() is None
    token = request_deadline_var.set(1000.0)
    try:
        d = request_deadline(60)
        assert isinstance(d, RequestDeadline) and d == 940.0
    finally:
        request_deadline_var.reset(token)


@pytest.fixture
def mocked():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _apply_body() -> dict:
    return {
        "inputs": {"objective": "A migration week operating packet.", "mode": "architect"},
        "active_iteration": {"iteration_number": 1, "prompt_sent": "", "output": "The packet.", "mode": "architect"},
        "iteration_number": 2,
        "chat_history": [{"id": "1", "iteration_number": 1, "role": "user", "content": "OPS-02 replaces OPS-01.", "created_at": ""}],
    }


def test_the_revision_keeps_time_for_its_checks(mocked):
    client, mock = mocked
    mock.generate_with_meta.side_effect = OpenRouterDeadlineError("Out of time after an empty reply", request_limit=True)
    res = client.post("/api/apply-to-answer", json=_apply_body())
    assert res.status_code == 502
    detail = res.json()["detail"]
    assert detail["code"] == OUT_OF_TIME
    assert "Nothing was changed" in detail["message"]
    deadline = mock.generate_with_meta.call_args.kwargs["deadline"]
    assert isinstance(deadline, RequestDeadline)
    # About the budget less the 60 s kept for the evaluation, suggestions and summary.
    assert DEFAULT_REQUEST_BUDGET_SECONDS - 75 < deadline - time.monotonic() < DEFAULT_REQUEST_BUDGET_SECONDS - 55


def test_a_one_minute_budget_reads_as_a_minute(monkeypatch):
    monkeypatch.setenv("REQUEST_BUDGET_SECONDS", "80")
    assert "about a minute" in classify_error(OpenRouterDeadlineError("x", request_limit=True)).message

