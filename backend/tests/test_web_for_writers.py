"""Every writer may search the web (22 Oct: "every AI agent should have web
access"), while the project's Web access switch is on.

One helper, `web_search.with_web`, decides and searches; what it finds joins
`inputs.sources`, so each prompt cites it through `context_block` as [S n].
These tests assert on prompts and responses, never on model output.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.llm_client import OpenRouterError
from promptmaster.web_search import with_web
from promptmaster.schemas import PMInput, SavedSource

SAVED = {"url": "https://example.org/saved", "title": "Already saved"}
INPUTS = {"objective": "Size the market for heat pumps in Portugal.", "audience": "Board", "mode": "analyst", "sources": [SAVED]}
FOUND = [
    {"type": "url_citation", "url_citation": {"url": "https://example.org/saved", "title": "Already saved", "content": "Old."}},
    {"type": "url_citation", "url_citation": {"url": "https://example.org/new", "title": "Heat pump sales 2025", "content": "Sales rose 12% in 2025."}},
]
DECIDE = "You decide whether a piece of work for a PromptMaster project needs a search"
EVALUATION = {
    "alignment": {"score": "High", "explanation": "ok"},
    "clarity": {"score": "High", "explanation": "ok"},
    "drift": {"score": "Low", "explanation": "ok"},
}


def _stub(search: bool = True, fail: bool = False, output: str = "Sales rose 12% [S2]; see [S9].") -> AsyncMock:
    stub = AsyncMock()

    async def generate_json(*args, **kwargs):
        system = kwargs.get("system", "")
        if system.startswith(DECIDE):
            return ({"search": search, "query": "heat pump sales Portugal 2025" if search else ""}, {})
        return (EVALUATION, {})

    stub.generate_json = AsyncMock(side_effect=generate_json)
    stub.generate_with_meta = AsyncMock(return_value=(output, {}, "stop"))
    stub.generate = AsyncMock(return_value=("Summary.", {}))
    if fail:
        stub.generate_with_web = AsyncMock(side_effect=OpenRouterError("down"))
    else:
        stub.generate_with_web = AsyncMock(return_value=("Sales rose 12% in 2025.", FOUND))
    return stub


@pytest.fixture
def post():
    def _post(path: str, body: dict, stub: AsyncMock):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app).post(path, json=body)

    yield _post
    app.dependency_overrides.pop(get_client, None)


def _decided(stub: AsyncMock) -> bool:
    return any(c.kwargs.get("system", "").startswith(DECIDE) for c in stub.generate_json.call_args_list)


def _written_prompt(stub: AsyncMock) -> str:
    return stub.generate_with_meta.call_args.kwargs["prompt"]


ITERATION = {"iteration_number": 1, "prompt_sent": "", "output": "Draft about heat pumps.", "mode": "analyst"}

# Each writer, with a body that is valid for it.
WRITERS = {
    "/api/generate-stage-artifact": {"inputs": INPUTS, "stage": {"id": "market", "label": "Market size", "renderer": "prose"}},
    "/api/apply-to-answer": {"inputs": INPUTS, "active_iteration": ITERATION, "iteration_number": 2,
                             "chat_history": [{"id": "1", "iteration_number": 1, "role": "user", "content": "Add 2025 sales", "created_at": ""}]},
    "/api/save-as-new-version": {"inputs": INPUTS, "active_iteration": ITERATION, "iteration_number": 2},
    "/api/continue-document": {"inputs": INPUTS, "incomplete_iteration": ITERATION, "iteration_number": 2},
    "/api/flow-trigger": {"inputs": INPUTS, "current_output": "Draft about heat pumps.", "trigger": "refine_concrete", "iteration_number": 2},
    "/api/apply-recommendations": {"inputs": INPUTS, "content": "Draft about heat pumps.",
                                   "findings": [{"id": "r1", "category": "fix", "summary": "Add sales", "suggested_change": "Add 2025 sales"}]},
}


def _text(path: str, body: dict) -> str:
    if "iteration" in body:
        return body["iteration"]["output"]
    return body["content"]


@pytest.mark.parametrize("path", WRITERS)
def test_off_by_default_nothing_is_decided_or_searched(post, path):
    stub = _stub()
    r = post(path, WRITERS[path], stub)
    assert r.status_code == 200, r.text
    assert not _decided(stub)
    stub.generate_with_web.assert_not_called()
    assert r.json()["web_sources"] == [] and r.json()["web_query"] == ""


@pytest.mark.parametrize("path", WRITERS)
def test_on_the_found_sources_are_cited_after_the_saved_ones(post, path):
    stub = _stub()
    r = post(path, {**WRITERS[path], "web_access": "on"}, stub)
    assert r.status_code == 200, r.text
    assert _decided(stub)
    prompt = _written_prompt(stub)
    assert "[S1] Already saved" in prompt and "[S2] Heat pump sales 2025" in prompt
    body = r.json()
    assert body["web_query"] == "heat pump sales Portugal 2025"
    # Only what is new to the project comes back, to be saved as [S2].
    assert [s["url"] for s in body["web_sources"]] == ["https://example.org/new"]
    text = _text(path, body)
    assert "[S2]" in text and "[S9]" not in text


@pytest.mark.parametrize("path", WRITERS)
def test_work_that_needs_no_web_is_not_searched(post, path):
    stub = _stub(search=False)
    r = post(path, {**WRITERS[path], "web_access": "on"}, stub)
    assert r.status_code == 200, r.text
    stub.generate_with_web.assert_not_called()
    assert r.json()["web_sources"] == []


@pytest.mark.parametrize("path", WRITERS)
def test_a_failed_search_still_does_the_work_and_says_so(post, path):
    stub = _stub(fail=True)
    r = post(path, {**WRITERS[path], "web_access": "on"}, stub)
    assert r.status_code == 200, r.text
    stub.generate_with_meta.assert_called()
    assert "web search failed" in r.json()["web_note"]


def test_go_reasoning_and_the_outline_search_too(post):
    stub = _stub()
    stub.generate_with_meta = AsyncMock(return_value=("Sales rose 12% [S2].", {"prompt_tokens": 1}, "stop"))
    r = post("/api/generate-outline", {"inputs": INPUTS, "web_access": "on"}, stub)
    # The outline's own parse may reject a mock reply; what matters is the search ran first.
    assert _decided(stub) and stub.generate_with_web.called, r.text


async def test_with_web_numbers_new_sources_after_the_saved_ones():
    stub = _stub()
    inputs = PMInput(objective="x", mode="analyst", sources=[SavedSource(**SAVED)])
    out, web = await with_web(stub, None, inputs, "on", task="market size")
    assert [s.url for s in out.sources] == ["https://example.org/saved", "https://example.org/new"]
    assert out.sources[1].retrieved  # dated, as a saved source is
    assert [s.url for s in web.web_sources] == ["https://example.org/new"]
    assert "THE WORK TO DO NOW:\nmarket size" in stub.generate_json.call_args.args[0]


async def test_with_web_off_is_untouched():
    stub = _stub()
    inputs = PMInput(objective="x", mode="analyst")
    out, web = await with_web(stub, None, inputs, "off", task="market size")
    assert out is inputs and web.web_query == ""
    stub.generate_json.assert_not_called()
