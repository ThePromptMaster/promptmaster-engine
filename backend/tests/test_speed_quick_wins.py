"""17 Nov (Paul, via Sean: about three times slower than ChatGPT). The search decision runs on the
small model; a draft's account and web lookups run at once when nothing is held from the accounts."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from promptmaster import web_search
from promptmaster.schemas import PMInput


@pytest.mark.asyncio
async def test_the_search_decisions_run_on_the_small_model():
    client = AsyncMock()
    client.generate_json.return_value = ({"search": False, "query": ""}, {})
    await web_search.decide_work_search(client, "anthropic/claude-opus-5.5", PMInput(objective="A memo", mode="analyst"), "Write the memo")
    assert client.generate_json.await_args.kwargs["model"] == web_search.DECIDE_MODEL == "anthropic/claude-haiku-5.5"
    await web_search.decide_chat_search(client, "anthropic/claude-opus-5.5", PMInput(objective="A memo", mode="analyst"), [], "What is the GDP of Kenya?", "")
    assert client.generate_json.await_args.kwargs["model"] == web_search.DECIDE_MODEL


def test_a_draft_runs_both_lookups_at_once_when_nothing_is_held(monkeypatch):
    from fastapi.testclient import TestClient

    from deps import account_owner, get_client, optional_composio
    from main import app
    from routers import stage as stage_router
    from promptmaster.schemas import AccountUse, ThirdPartyItem

    order: list[str] = []

    async def accounts(*a, **k):
        order.append("accounts:start")
        await asyncio.sleep(0.05)
        order.append("accounts:end")
        item = ThirdPartyItem(kind="file", title="Board pack", text="Revenue grew.")
        return a[3].model_copy(update={"third_party": [item]}), AccountUse(account_items=[item])

    async def web(client, model, inputs, access, **k):
        order.append("web:start")
        await asyncio.sleep(0.05)
        order.append("web:end")
        return inputs, web_search.WebUse()

    seen: dict = {}

    async def generate(**k):
        seen["inputs"] = k["inputs"]
        from promptmaster.schemas import GenerateStageArtifactResponse
        return GenerateStageArtifactResponse(content="Draft.", finish_reason="stop")

    monkeypatch.setattr(stage_router, "with_accounts", accounts)
    monkeypatch.setattr(stage_router, "with_web", web)
    monkeypatch.setattr(stage_router, "generate_stage_artifact", generate)
    app.dependency_overrides[get_client] = lambda: AsyncMock()
    app.dependency_overrides[optional_composio] = lambda: object()
    app.dependency_overrides[account_owner] = lambda: "u1"
    try:
        r = TestClient(app).post("/api/generate-stage-artifact", json={
            "inputs": {"objective": "A memo", "mode": "analyst"},
            "stage": {"id": "memo", "label": "Memo", "renderer": "prose"},
            "account_search": "on", "web_access": "on",
        })
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200, r.text
    assert order.index("web:start") < order.index("accounts:end")
    assert [i.title for i in seen["inputs"].third_party] == ["Board pack"]
