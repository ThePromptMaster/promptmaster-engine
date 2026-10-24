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


def test_the_search_is_sent_the_query_not_the_brief():
    """Sean, 23 Oct: a pricing query returned childcare tools because the whole
    brief, twice, was what the engine searched."""
    brief = "Help me choose an AI documentation workflow for Little Steps Learning, an early-intervention business. " * 30
    stub = _stub({"search": True, "query": "Claude Pro plan pricing official Anthropic"})
    r = _post({"turns": [{"role": "user", "content": brief}], "web_access": "on"}, stub)
    assert r.status_code == 200, r.text
    assert stub.generate_with_web.call_args.args[0] == "Claude Pro plan pricing official Anthropic"
    assert len(stub.generate_with_web.call_args.kwargs["system"]) < 1_500
    # Room for a long brief and its results: the reply no longer comes back empty.
    assert stub.generate_json.call_args_list[1].kwargs["max_tokens"] >= 4_000


def test_a_brief_with_no_reply_says_what_happened_rather_than_asking_again():
    from promptmaster.front_door import Turn, parse_front_door

    turns = [Turn(role="user", content="A memo comparing Claude and Copilot for Nancy, under $60 a month")]
    done = parse_front_door({"reply": "", "brief": {"objective": "Compare AI tools for Nancy"}, "enough": True}, turns)
    assert done.ready and "enough to set the project up" in done.reply
    partway = parse_front_door({"brief": {"objective": "Compare AI tools for Nancy"}}, turns)
    assert "Tell me more" not in partway.reply


def test_a_decision_that_is_not_an_object_is_no_search():
    stub = _stub()
    stub.generate_json = AsyncMock(side_effect=[(["search"], {}), (REPLY, {})])
    r = _post(_body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    stub.generate_with_web.assert_not_called()


def test_a_prose_answer_is_asked_again_as_json():
    """Sean, 23 Oct: with pricing results in the prompt the model answered in
    prose; the repair returned {"error": ...}, shown as "Tell me more"."""
    from promptmaster.llm_client import NotJSONError

    stub = _stub({"search": True, "query": "Claude Pro price"})
    stub.generate_json = AsyncMock(side_effect=[
        ({"search": True, "query": "Claude Pro price"}, {}),
        NotJSONError("prose", content="Claude Pro is $20 a month [S2]."),
        (REPLY, {}),
    ])
    r = _post(_body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    assert r.json()["reply"].startswith("Portugal has about 10.7 million")
    assert "JSON object only" in stub.generate_json.call_args_list[2].kwargs["system"]


def test_when_no_json_comes_the_prose_is_the_reply_and_the_outline_stays():
    from promptmaster.llm_client import NotJSONError

    stub = _stub({"search": True, "query": "Claude Pro price"})
    prose = NotJSONError("prose", content="Claude Pro is $20 a month [S2].")
    stub.generate_json = AsyncMock(side_effect=[({"search": True, "query": "Claude Pro price"}, {}), prose, prose, prose])
    r = _post(_body(web_access="on", brief={"objective": "Pick a tool"}), stub)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"] == "Claude Pro is $20 a month [S2]."
    assert body["brief"]["objective"] == "Pick a tool" and body["ready"] is False


def test_a_filtered_answer_is_tried_once_more_without_the_results():
    from promptmaster.llm_client import OpenRouterError

    stub = _stub({"search": True, "query": "Claude Pro price"})
    blocked = OpenRouterError("No content in response (finish_reason='content_filter')")
    stub.generate_json = AsyncMock(side_effect=[({"search": True, "query": "Claude Pro price"}, {}), blocked, blocked, (REPLY, {})])
    r = _post(_body(web_access="on"), stub)
    assert r.status_code == 200, r.text
    assert "NEW WEB RESULTS" not in stub.generate_json.call_args_list[3].kwargs["prompt"]
    body = r.json()
    assert body["web_sources"] == [] and "could not be used" in body["web_note"]
