"""Tests for OpenRouterClient.generate_with_meta()."""

from unittest.mock import AsyncMock, patch

import pytest

from promptmaster.llm_client import OpenRouterClient


@pytest.mark.asyncio
async def test_generate_with_meta_returns_finish_reason():
    """generate_with_meta returns (content, usage, finish_reason) tuple."""
    client = OpenRouterClient(api_key="test-key")
    fake_response_data = {
        "choices": [
            {
                "message": {"content": "Hello world"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    }

    fake_response = AsyncMock()
    fake_response.status_code = 200
    fake_response.json = lambda: fake_response_data
    fake_response.raise_for_status = lambda: None

    with patch.object(client._client, "post", return_value=fake_response):
        content, usage, finish_reason = await client.generate_with_meta(
            prompt="hi", system="you are helpful"
        )

    assert content == "Hello world"
    assert usage["tokens_in"] == 10
    assert usage["tokens_out"] == 5
    assert finish_reason == "stop"

    await client.close()


@pytest.mark.asyncio
async def test_generate_with_meta_propagates_length_finish_reason():
    """When the LLM hits max_tokens, finish_reason='length' must surface."""
    client = OpenRouterClient(api_key="test-key")
    fake_response_data = {
        "choices": [
            {
                "message": {"content": "Partial response that was cut..."},
                "finish_reason": "length",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 16384},
    }

    fake_response = AsyncMock()
    fake_response.status_code = 200
    fake_response.json = lambda: fake_response_data
    fake_response.raise_for_status = lambda: None

    with patch.object(client._client, "post", return_value=fake_response):
        content, usage, finish_reason = await client.generate_with_meta(prompt="hi")

    assert finish_reason == "length"

    await client.close()


@pytest.mark.asyncio
async def test_existing_generate_still_returns_two_tuple():
    """Existing generate() must keep its (content, usage) signature unchanged."""
    client = OpenRouterClient(api_key="test-key")
    fake_response_data = {
        "choices": [
            {
                "message": {"content": "Hello"},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 5, "completion_tokens": 2},
    }
    fake_response = AsyncMock()
    fake_response.status_code = 200
    fake_response.json = lambda: fake_response_data
    fake_response.raise_for_status = lambda: None

    with patch.object(client._client, "post", return_value=fake_response):
        result = await client.generate(prompt="hi")

    assert isinstance(result, tuple)
    assert len(result) == 2  # Must still be 2-tuple
    content, usage = result
    assert content == "Hello"

    await client.close()


async def test_a_repair_that_finds_no_json_is_an_error_not_an_answer(monkeypatch):
    """23 Oct: prose came back where JSON was asked for, and the repair pass
    answered {"error": "Input was not JSON…"} — passed on as if it were the reply."""
    import pytest
    from promptmaster.llm_client import NotJSONError, OpenRouterClient

    client = OpenRouterClient(api_key="k")
    replies = iter([("Claude Pro is $20 a month.", {}), ('{"error": "Input was not JSON."}', {})])

    async def fake_generate(**_kw):
        return next(replies)

    monkeypatch.setattr(client, "generate", fake_generate)
    with pytest.raises(NotJSONError) as caught:
        await client.generate_json("q")
    assert caught.value.content == "Claude Pro is $20 a month."


async def test_prose_with_no_object_is_not_sent_for_repair(monkeypatch):
    """Sean, 24 Oct: the start chat answered in prose, the repair pass was
    answered by the content filter, and the prose was lost to a 502."""
    import pytest
    from promptmaster.llm_client import NotJSONError, OpenRouterClient

    client = OpenRouterClient(api_key="k")
    calls = []

    async def fake_generate(**kw):
        calls.append(kw)
        return "Here are three screening criteria to start from.", {}

    monkeypatch.setattr(client, "generate", fake_generate)
    with pytest.raises(NotJSONError) as caught:
        await client.generate_json("q")
    assert caught.value.content == "Here are three screening criteria to start from."
    assert len(calls) == 1


async def test_a_filtered_repair_keeps_the_first_answer(monkeypatch):
    import pytest
    from promptmaster.llm_client import NotJSONError, OpenRouterClient, OpenRouterError

    client = OpenRouterClient(api_key="k")
    replies = iter([('{"reply": "Half an obj', {}), OpenRouterError("No content in response (finish_reason='content_filter')")])

    async def fake_generate(**_kw):
        r = next(replies)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(client, "generate", fake_generate)
    with pytest.raises(NotJSONError) as caught:
        await client.generate_json("q")
    assert caught.value.content == '{"reply": "Half an obj'
