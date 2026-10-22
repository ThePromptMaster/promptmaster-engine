"""The start screen's conversation searches the web (22 Oct, client: "I don't
think the internet works with the initial chatbox"): the side chat's decision
and search, while Web access is on."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.llm_client import OpenRouterError

ANNOTATIONS = [
    {"type": "url_citation", "url_citation": {"url": "https://example.org/earlier", "title": "Found earlier", "content": "Old."}},
    {"type": "url_citation", "url_citation": {"url": "https://example.org/new", "title": "Census 2025", "content": "Portugal had 10.7 million people."}},
]

REPLY = {"reply": "Portugal has about 10.7 million people [S2]; see also [S9].", "brief": {"objective": "A guide to Portugal"}, "enough": False}


def _stub(decision: dict | Exception | None = None, search: Exception | None = None) -> AsyncMock:
    stub = AsyncMock()
    first = decision if isinstance(decision, Exception) else (decision or {"search": False, "query": ""}, {})
    stub.generate_json = AsyncMock(side_effect=[first, (REPLY, {})] if not isinstance(decision, Exception) else [decision])
    if search:
        stub.generate_with_web = AsyncMock(side_effect=search)
    else:
        stub.generate_with_web = AsyncMock(return_value=("Portugal had 10.7 million people.", ANNOTATIONS))
    return stub


def _post(body: dict, stub: AsyncMock):
    app.dependency_overrides[get_client] = lambda: stub
    try:
        return TestClient(app).post("/api/front-door", json=body)
    finally:
        app.dependency_overrides.pop(get_client, None)


def _body(**extra) -> dict:
    return {"turns": [{"role": "user", "content": "How many people live in Portugal today?"}], **extra}


def test_without_web_access_the_turn_is_one_call_and_no_search():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=(REPLY, {}))
    r = _post(_body(), stub)
    assert r.status_code == 200, r.text
    assert stub.generate_json.call_count == 1
    stub.generate_with_web.assert_not_called()
    assert r.json()["web_sources"] == [] and r.json()["web_query"] == ""


def test_a_question_about_the_world_is_searched_and_cited_after_what_was_found_before():
    stub = _stub({"search": True, "query": "Portugal population 2025"})
    earlier = [{"url": "https://example.org/earlier", "title": "Found earlier"}]
    r = _post(_body(web_access="on", sources=earlier), stub)
    assert r.status_code == 200, r.text
    assert "THE USER ASKS:\nHow many people live in Portugal today?" in stub.generate_json.call_args_list[0].args[0]
    prompt = stub.generate_json.call_args_list[1].kwargs["prompt"]
    assert "WEB SEARCH IN THIS CHAT: on" in prompt
    assert "NEW WEB RESULTS" in prompt and "[S1] Found earlier" in prompt and "[S2] Census 2025" in prompt
    body = r.json()
    assert body["web_query"] == "Portugal population 2025"
    # Only what is new to the conversation comes back, to be kept.
    assert [s["url"] for s in body["web_sources"]] == ["https://example.org/new"]
    # A citation to a source nobody found is removed.
    assert "[S2]" in body["reply"] and "[S9]" not in body["reply"]


def test_a_turn_that_needs_no_web_is_not_searched():
    stub = _stub({"search": False, "query": ""})
    r = _post(_body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    stub.generate_with_web.assert_not_called()
    assert "NEW WEB RESULTS" not in stub.generate_json.call_args_list[1].kwargs["prompt"]
    assert r.json()["web_sources"] == []


def test_a_failed_search_still_gets_a_reply_and_says_so():
    stub = _stub({"search": True, "query": "Portugal population"}, search=OpenRouterError("down"))
    r = _post(_body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"].startswith("Portugal has about")
    assert body["web_sources"] == [] and "web search failed" in body["web_note"]
