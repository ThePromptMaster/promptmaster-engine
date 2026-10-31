"""Web search (20 Oct, Sean: "web search and source retrieval … with citations
and saved sources? On and off button?")."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.web_search import build_search_prompt, keep_found_links, sources_from, WebSource
from promptmaster.schemas import PMInput

ANNOTATIONS = [
    {"type": "url_citation", "url_citation": {"url": "https://example.org/a", "title": "A report", "content": "Growth was 4%."}},
    {"type": "url_citation", "url_citation": {"url": "https://example.org/a", "title": "Duplicate"}},
    {"type": "url_citation", "url_citation": {"url": "javascript:alert(1)", "title": "Not a web link"}},
]


def _inputs(objective: str = "Screen Harbor Industrial Services for Northbridge.") -> PMInput:
    return PMInput(objective=objective, mode="analyst")


def _post(body: dict, stub: AsyncMock):
    app.dependency_overrides[get_client] = lambda: stub
    try:
        return TestClient(app).post("/api/agent/web-search", json=body)
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_web_search_is_refused_while_the_switch_is_off():
    stub = AsyncMock()
    r = _post({"inputs": _inputs().model_dump(), "query": "Harbor Industrial Services revenue"}, stub)
    assert r.status_code == 403
    assert "Web access is off" in r.json()["detail"]
    stub.generate_with_web.assert_not_called()


def test_web_search_returns_the_searchs_own_sources_and_unlinks_any_other():
    stub = AsyncMock()
    stub.generate_with_web.return_value = (
        "Growth was 4% ([example.org](https://example.org/a)); a rival says 9% ([made up](https://invented.example/x)).",
        ANNOTATIONS,
    )
    r = _post({"inputs": _inputs().model_dump(), "query": "Harbor revenue growth", "purpose": "the growth row", "web_access": "on"}, stub)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sources"] == [{"url": "https://example.org/a", "title": "A report", "excerpt": "Growth was 4%."}]
    assert "[example.org](https://example.org/a)" in body["summary"]
    assert "invented.example" not in body["summary"] and "made up" in body["summary"]
    # The engine searches the user message, so it is the query alone; the
    # project and the reason ride in the system message (23 Oct).
    assert stub.generate_with_web.call_args.args[0] == "Harbor revenue growth"
    system = stub.generate_with_web.call_args.kwargs["system"]
    assert "Never invent a source" in system and "WHAT THIS SEARCH IS FOR: the growth row" in system


def test_sources_and_links_helpers():
    sources = sources_from(ANNOTATIONS)
    assert [s.url for s in sources] == ["https://example.org/a"]
    assert keep_found_links("See https://example.org/a and https://other.example/b.", [WebSource(url="https://example.org/a")]) == "See https://example.org/a and ."
    system, user = build_search_prompt(_inputs(), "q")
    assert user == "q" and "THE PROJECT: Screen Harbor" in system


def test_a_long_brief_is_never_what_is_searched():
    """Sean, 23 Oct: "Claude Pro plan pricing … official Anthropic" returned
    childcare tools — the search had been sent the whole early-intervention brief."""
    brief = "Little Steps Learning LLC serves families with children from birth to age three. " * 40
    system, user = build_search_prompt(_inputs(objective=brief), "Claude Pro plan pricing official", purpose=brief)
    assert user == "Claude Pro plan pricing official"
    assert "Little Steps" not in user
    assert len(system) < 1_200


async def test_the_client_asks_for_the_web_plugin_and_reads_the_annotations(monkeypatch):
    from promptmaster import llm_client
    from promptmaster.llm_client import OpenRouterClient

    client = OpenRouterClient(api_key="k")
    sent: dict = {}

    async def fake(payload, headers, timeout, deadline):
        sent.update(payload)
        llm_client.WEB_ANNOTATIONS.set(ANNOTATIONS)
        return "summary", {"tokens_in": 1, "tokens_out": 1}, "stop"

    monkeypatch.setattr(client, "_request_with_retries", fake)
    content, annotations = await client.generate_with_web("p", system="s", max_results=3)
    assert content == "summary" and annotations == ANNOTATIONS
    assert sent["plugins"] == [{"id": "web", "engine": "exa", "max_results": 3}]
    assert sent["usage"] == {"include": True}


def test_saved_sources_reach_every_prompt_numbered_with_the_citation_rule():
    from promptmaster.project_context import context_block
    from promptmaster.schemas import SavedSource

    inputs = _inputs().model_copy(update={"sources": [
        SavedSource(url="https://example.org/a", title="A report", excerpt="Growth was 4%.", retrieved="2026-10-20"),
        SavedSource(url="https://example.org/b"),
    ]})
    block = context_block(inputs)
    assert "SOURCES ON RECORD" in block and "Never cite a source that is not listed here" in block
    assert "[S1] A report — https://example.org/a, retrieved 2026-10-20\n  Growth was 4%." in block
    assert "[S2] https://example.org/b — https://example.org/b" in block
    assert context_block(_inputs()) == ""


def test_a_stage_draft_loses_citations_to_sources_the_project_does_not_hold():
    from promptmaster.web_search import strip_unknown_citations

    assert strip_unknown_citations("Growth was 4% [S1]; a rival says 9% [S7].", 2) == "Growth was 4% [S1]; a rival says 9% ."
    assert strip_unknown_citations("Nothing cited [S1].", 0) == "Nothing cited ."


def test_the_model_is_told_not_to_write_a_sources_list():
    """31 Oct (Sean, a book at v8): every writer was told to "end with a Sources
    list", and the draft carried a 40-row table more than once."""
    from promptmaster.project_context import context_block
    from promptmaster.schemas import SavedSource

    block = context_block(_inputs().model_copy(update={"sources": [SavedSource(url="https://example.org/a")]}))
    assert "end with a" not in block
    assert "Do not write a Sources, References or Works cited list or table" in block
    assert "PromptMaster lists the sources a text cites beneath it" in block


def test_a_source_sent_with_its_number_keeps_it_past_forty():
    """31 Oct: past 40 sources the browser sends a selection, each with its number."""
    from promptmaster.project_context import context_block, highest_source_number
    from promptmaster.schemas import SavedSource

    sources = [
        SavedSource(url="https://example.org/old", title="Old", n=3),
        SavedSource(url="https://example.org/new", title="New", n=52),
    ]
    block = context_block(_inputs().model_copy(update={"sources": sources}))
    assert "[S3] Old — https://example.org/old" in block
    assert "[S52] New — https://example.org/new" in block
    assert highest_source_number(sources) == 52
    assert highest_source_number([SavedSource(url="https://a.org"), SavedSource(url="https://b.org")]) == 2
    assert highest_source_number([]) == 0


def test_new_finds_are_numbered_after_the_highest_number_sent():
    from promptmaster.schemas import SavedSource
    from promptmaster.web_search import numbered_found

    saved = [SavedSource(url="https://example.org/old", n=3), SavedSource(url="https://example.org/new", n=52)]
    found = [WebSource(url="https://example.org/new"), WebSource(url="https://example.org/fresh"), WebSource(url="https://example.org/other")]
    assert [(n, s.url, new) for n, s, new in numbered_found(saved, found)] == [
        (52, "https://example.org/new", False),
        (53, "https://example.org/fresh", True),
        (54, "https://example.org/other", True),
    ]


async def test_with_web_gives_what_it_found_the_numbers_it_cites_them_by():
    from promptmaster.schemas import SavedSource
    from promptmaster.web_search import cite_only_known, with_web

    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"search": True, "query": "Illinois credit rating upgrade"}, {}))
    stub.generate_with_web = AsyncMock(return_value=("Upgraded.", [
        {"type": "url_citation", "url_citation": {"url": "https://example.org/rating", "title": "Rating"}},
    ]))
    inputs = _inputs().model_copy(update={"sources": [SavedSource(url="https://example.org/a", n=40)]})
    out, web = await with_web(stub, None, inputs, "on", "Write the chapter")
    assert web.web_query == "Illinois credit rating upgrade"
    assert out.sources[-1].n == 41 and out.sources[-1].url == "https://example.org/rating"
    assert cite_only_known("A [S41], B [S42].", out, web) == "A [S41], B ."
