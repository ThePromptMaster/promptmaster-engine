"""Adaptive "Guide me" (1 Oct feedback, item 9): one question at a time, and enough is an answer."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.setup_suggester import (
    GUIDE_NEXT_SYSTEM, MAX_GUIDE_QUESTIONS, build_guide_next_prompt, parse_guide_next, suggest_next_guide_question,
)


def test_the_prompt_carries_the_answers_so_far_and_allows_stopping():
    prompt = build_guide_next_prompt("Diagnose churn", [{"question": "What data do you have?", "answer": "CRM; Billing"}])
    assert "Q: What data do you have?" in prompt
    assert "A: CRM; Billing" in prompt
    assert '{"enough": true' in prompt
    assert "Let the answers so far decide what to ask next" in GUIDE_NEXT_SYSTEM
    assert "Say there is enough only when no answer could change the setup" in " ".join(GUIDE_NEXT_SYSTEM.split())
    assert 'Set "multi" to true when several of the options could apply at once' in GUIDE_NEXT_SYSTEM
    assert "(nothing asked yet)" in build_guide_next_prompt("x", [])


def test_parse_returns_the_question_with_multi_only_when_there_are_options_to_combine():
    enough, q, _ = parse_guide_next({"enough": False, "question": {
        "question": "What data do you have?", "why": "It decides what can be run.",
        "options": ["CRM", "Billing", "Support", "None", "Extra"], "multi": True}}, asked=2)
    assert not enough
    assert q.id == "q3"
    assert q.options == ["CRM", "Billing", "Support", "None"]
    assert q.multi is True
    _, single, _ = parse_guide_next({"enough": False, "question": {"question": "Who is it for?", "options": ["Me"], "multi": True}}, asked=0)
    assert single.multi is False


def test_enough_and_anything_unusable_both_end_the_questions():
    assert parse_guide_next({"enough": True, "reason": "Audience and data are known."}, 2) == (True, None, "Audience and data are known.")
    assert parse_guide_next({"enough": False, "question": {"question": "  "}}, 1)[0] is True
    assert parse_guide_next("nope", 0)[0] is True


@pytest.mark.asyncio
async def test_no_call_past_the_limit_and_generic_questions_when_the_call_fails():
    client = AsyncMock()
    answered = [{"question": f"q{i}", "answer": "a"} for i in range(MAX_GUIDE_QUESTIONS)]
    assert (await suggest_next_guide_question(client, None, "x", answered))[0] is True
    client.generate_json.assert_not_called()

    client.generate_json.side_effect = RuntimeError("provider down")
    enough, q, _ = await suggest_next_guide_question(client, None, "x", [])
    assert not enough and q.question == "Who is this for?"
    enough, q, _ = await suggest_next_guide_question(client, None, "x", [{"question": "Who is this for?", "answer": "Me"}])
    assert not enough and q.question == "What would a great result look like?" and q.id == "q2"


def test_the_route_returns_the_next_question_or_enough():
    client = AsyncMock()
    client.generate_json.return_value = ({"enough": True, "reason": "Known."}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/guide-next-question", json={"objective": "Diagnose churn", "answered": [{"question": "q", "answer": "a"}]})
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json() == {"enough": True, "question": None, "reason": "Known.", "web_query": "", "web_sources": [], "web_note": ""}


def test_ask_me_questions_searches_the_web_when_it_is_on():
    """Sean, 22 Oct: web search "probably needs to be added to the 'ask me questions' button too"."""
    from unittest.mock import AsyncMock as _AM
    from fastapi.testclient import TestClient as _TC
    from deps import get_client as _gc
    from main import app as _app

    stub = _AM()
    stub.generate_json = _AM(side_effect=[
        ({"search": True, "query": "Claude Pro price per month"}, {}),
        ({"enough": False, "question": {"question": "Which plan fits the budget?", "why": "Price decides", "options": ["Pro", "Max"]}}, {}),
    ])
    stub.generate_with_web = _AM(return_value=("Pro is $20.", [{"url_citation": {"url": "https://claude.com/pricing", "title": "Plans & Pricing", "content": "Pro $20/month"}}]))
    _app.dependency_overrides[_gc] = lambda: stub
    try:
        r = _TC(_app).post("/api/guide-next-question", json={"objective": "Pick an AI tool under $60 a month", "web_access": "on"})
    finally:
        _app.dependency_overrides.pop(_gc, None)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["web_query"] == "Claude Pro price per month"
    assert [s["url"] for s in body["web_sources"]] == ["https://claude.com/pricing"]
    assert "Plans & Pricing" in stub.generate_json.call_args_list[1].kwargs["prompt"]


def test_ask_me_questions_does_not_search_with_web_off():
    from unittest.mock import AsyncMock as _AM
    from fastapi.testclient import TestClient as _TC
    from deps import get_client as _gc
    from main import app as _app

    stub = _AM()
    stub.generate_json = _AM(return_value=({"enough": True, "reason": "ok"}, {}))
    _app.dependency_overrides[_gc] = lambda: stub
    try:
        r = _TC(_app).post("/api/guide-next-question", json={"objective": "Pick an AI tool"})
    finally:
        _app.dependency_overrides.pop(_gc, None)
    assert r.status_code == 200 and r.json()["web_sources"] == []
    stub.generate_with_web.assert_not_called()


def test_advanced_keeps_asking_while_answers_still_matter():
    """31 Oct: "Is the ask questions option on advanced set up for only 3
    questions … As many questions as possible for that." """
    assert MAX_GUIDE_QUESTIONS == 12
    assert "three questions is often enough" not in GUIDE_NEXT_SYSTEM
    assert "never merely because a few questions have been asked" in GUIDE_NEXT_SYSTEM
    # Advanced is not told a count; only the simple start is.
    assert "At most" not in build_guide_next_prompt("x", [{"question": "q", "answer": "a"}] * 5)
    assert "At most 3 questions" in build_guide_next_prompt("x", [], limit=3)
