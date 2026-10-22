"""The side chat searches the web (22 Oct): it decides when a question needs
the web, and only while the project's Web access switch is on."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.llm_client import OpenRouterError
from promptmaster.schemas import PMInput, SavedSource
from promptmaster.web_search import numbered_found, WebSource

ANNOTATIONS = [
    {"type": "url_citation", "url_citation": {"url": "https://example.org/saved", "title": "Already saved", "content": "Old."}},
    {"type": "url_citation", "url_citation": {"url": "https://example.org/new", "title": "Fresh report", "content": "Revenue rose 4% in 2025."}},
]


def _inputs(**extra) -> dict:
    return PMInput(objective="Screen Harbor Industrial Services for Northbridge.", mode="analyst", **extra).model_dump()


def _stub(decision: dict | Exception | None = None, reply: str = "Revenue rose 4% [S2]; also [S9].") -> AsyncMock:
    stub = AsyncMock()
    stub.generate = AsyncMock(return_value=(reply, {}))
    if isinstance(decision, Exception):
        stub.generate_json = AsyncMock(side_effect=decision)
    else:
        stub.generate_json = AsyncMock(return_value=(decision or {"search": False, "query": ""}, {}))
    stub.generate_with_web = AsyncMock(return_value=("Revenue rose 4% ([example.org](https://example.org/new)).", ANNOTATIONS))
    return stub


def _post(body: dict, stub: AsyncMock):
    app.dependency_overrides[get_client] = lambda: stub
    try:
        return TestClient(app).post("/api/chat-message", json=body)
    finally:
        app.dependency_overrides.pop(get_client, None)


@pytest.fixture
def body(basic_iteration):
    def make(**extra) -> dict:
        return {
            "inputs": _inputs(),
            "active_iteration": basic_iteration.model_dump(mode="json"),
            "user_message": "What is Harbor's latest revenue growth?",
            **extra,
        }
    return make


def _reply_prompt(stub: AsyncMock) -> str:
    return stub.generate.call_args.kwargs["prompt"]


def test_with_web_access_off_the_chat_neither_decides_nor_searches(body):
    stub = _stub({"search": True, "query": "Harbor revenue"})
    r = _post(body(), stub)
    assert r.status_code == 200, r.text
    stub.generate_json.assert_not_called()
    stub.generate_with_web.assert_not_called()
    assert "NEW WEB RESULTS" not in _reply_prompt(stub)
    body = r.json()
    assert body["web_query"] == "" and body["web_sources"] == []
    # Off, the reply is untouched: citations are not stripped.
    assert "[S9]" in body["assistant_message"]["content"]


def test_a_question_that_needs_no_web_is_not_searched(body):
    stub = _stub({"search": False, "query": ""})
    r = _post(body(web_access="on", user_message="Can you shorten the second paragraph?"), stub)
    assert r.status_code == 200, r.text
    stub.generate_json.assert_called_once()
    assert "THE USER ASKS:\nCan you shorten the second paragraph?" in stub.generate_json.call_args.args[0]
    assert "Do not search for a question about the document itself" in stub.generate_json.call_args.kwargs["system"]
    stub.generate_with_web.assert_not_called()
    assert r.json()["web_sources"] == []


def test_a_question_about_the_world_is_searched_and_cited_by_the_numbers_it_will_be_saved_under(body):
    stub = _stub({"search": True, "query": "Harbor Industrial Services revenue growth 2025"})
    saved = [SavedSource(url="https://example.org/saved", title="Already saved")]
    r = _post(body(web_access="on", inputs=_inputs(sources=saved)), stub)
    assert r.status_code == 200, r.text
    assert "SEARCH FOR: Harbor Industrial Services revenue growth 2025" in stub.generate_with_web.call_args.args[0]
    prompt = _reply_prompt(stub)
    found = prompt.split("NEW WEB RESULTS", 1)[1]
    # The saved link keeps [S1]; the new one follows it.
    assert "[S1] Already saved — https://example.org/saved" in found
    assert "[S2] Fresh report — https://example.org/new\n  Revenue rose 4% in 2025." in found
    assert prompt.index("NEW WEB RESULTS") < prompt.index("USER MESSAGE:")
    body = r.json()
    assert body["web_query"] == "Harbor Industrial Services revenue growth 2025"
    # Only what is not yet on record goes back to be saved.
    assert body["web_sources"] == [{"url": "https://example.org/new", "title": "Fresh report", "excerpt": "Revenue rose 4% in 2025."}]
    # [S9] points at nothing the project will hold, so it is removed.
    assert body["assistant_message"]["content"] == "Revenue rose 4% [S2]; also ."


def test_a_failed_search_still_answers_and_says_so(body):
    stub = _stub(OpenRouterError("OpenRouter API error 500", status_code=500))
    r = _post(body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assistant_message"]["content"]
    assert "web search failed" in body["web_note"]
    assert body["web_sources"] == []
    assert "NEW WEB RESULTS" not in _reply_prompt(stub)


def test_a_decision_without_words_to_search_is_no_search(body):
    stub = _stub({"search": True, "query": " "})
    r = _post(body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    stub.generate_with_web.assert_not_called()


def test_found_sources_are_numbered_after_the_saved_ones():
    saved = [SavedSource(url="https://a.example/1"), SavedSource(url="https://a.example/2")]
    found = [WebSource(url="https://b.example/x"), WebSource(url="https://a.example/2"), WebSource(url="https://b.example/y")]
    assert [(n, s.url, new) for n, s, new in numbered_found(saved, found)] == [
        (3, "https://b.example/x", True),
        (2, "https://a.example/2", False),
        (4, "https://b.example/y", True),
    ]


def test_the_chat_is_told_it_can_search_even_when_this_message_did_not(body):
    # 22 Oct: "can you access the internet" — rightly not searched — was answered
    # "No, I can't browse" while Web access was on.
    stub = _stub({"search": False, "query": ""})
    r = _post(body(web_access="on", user_message="can you access the internet"), stub)
    assert r.status_code == 200, r.text
    prompt = _reply_prompt(stub)
    assert "WEB SEARCH IN THIS CHAT: on" in prompt and "say yes" in prompt
    assert "Never say you searched when no new web results are given below" in prompt
    assert "When the user asks you to search or look something up, search" in stub.generate_json.call_args.kwargs["system"]


def test_with_web_access_off_the_chat_is_told_it_cannot_search_and_how_to_turn_it_on(body):
    stub = _stub()
    _post(body(user_message="can you access the internet"), stub)
    prompt = _reply_prompt(stub)
    assert "WEB SEARCH IN THIS CHAT: off for this project" in prompt
    assert "turning on Web access under Web sources" in prompt
    assert "WEB SEARCH IN THIS CHAT: on" not in prompt
