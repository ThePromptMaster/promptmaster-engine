"""Filling in the blanks on an outreach list (Sean, 26 Nov): every value a page shows, or nothing.

The model's output is scripted; what is asserted is what code keeps of it, and the prompt.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.outreach_research import (
    ResearchRow,
    apply_pattern,
    build_read_prompt,
    inbox_kind,
    pattern_of,
    queries_for,
)
from promptmaster.schemas import PMInput

client = TestClient(app)

INPUTS = {"objective": "Offer the PromptMaster beta to heads of operations.", "audience": "", "mode": "clarity"}
TEAM_PAGE = {
    "url": "https://harbourline.example/team",
    "title": "Our team — Harbourline Supply",
    "content": "Meet the team. Morgan Reyes, Head of Operations, runs our Leeds cold-chain hub. "
    "Press: jane.doe@harbourline.example (Jane Doe, Communications). General enquiries: info@harbourline.example.",
}
NEWS_PAGE = {
    "url": "https://news.example/harbourline-leeds",
    "title": "Harbourline opens cold-chain hub in Leeds",
    "content": "Harbourline Supply opened a new cold-chain hub in Leeds this autumn, doubling its chilled capacity for northern retailers.",
}


def _stub(read: dict, pages_by_query=None):
    stub = AsyncMock()

    async def web(query, **_kw):
        pages = (pages_by_query or (lambda q: [TEAM_PAGE, NEWS_PAGE]))(query)
        return "titles", [{"type": "url_citation", "url_citation": p} for p in pages]

    stub.generate_with_web = AsyncMock(side_effect=web)
    stub.generate_json = AsyncMock(return_value=(read, {}))
    app.dependency_overrides[get_client] = lambda: stub
    return stub


def _post(rows, web_access="on", sources=None):
    inputs = dict(INPUTS, sources=sources or [])
    return client.post("/api/outreach/research", json={"inputs": inputs, "brief": "Write to the head of operations.", "rows": rows, "web_access": web_access})


def teardown_function():
    app.dependency_overrides.pop(get_client, None)


ROW = {"id": "c1", "company": "Harbourline Supply", "domain": "harbourline.example", "website": "https://harbourline.example"}


def test_fills_only_what_a_page_shows_each_with_its_source():
    stub = _stub({"rows": [{
        "id": "c1", "name": "Morgan Reyes", "name_page": 1, "role": "Head of Operations", "role_page": 1,
        "email": "morgan.reyes@harbourline.example", "email_page": 1,
        "owners": [{"email": "jane.doe@harbourline.example", "name": "Jane Doe", "page": 1}],
        "detail": "Harbourline opened a new cold-chain hub in Leeds this autumn", "detail_page": 2,
        "personal_line": "Your new cold-chain hub in Leeds caught my eye.", "candidates": [], "not_found": "",
    }]})
    r = _post([ROW], sources=[{"url": "https://old.example", "title": "old", "excerpt": "", "n": 1}])
    assert r.status_code == 200, r.text
    row = r.json()["rows"][0]
    assert (row["name"], row["src_name"], row["role"]) == ("Morgan Reyes", "[S2]", "Head of Operations")
    # The address no page shows is not taken; the colleague's address gives a guess, made by code.
    assert row["email"] == "morgan.reyes@harbourline.example" and row["email_status"] == "guess"
    assert row["guessed_from"] == "jane.doe@harbourline.example [S2]"
    assert (row["detail"], row["src_detail"]) == ("Harbourline opened a new cold-chain hub in Leeds this autumn", "[S3]")
    assert row["personal_line"] == "Your new cold-chain hub in Leeds caught my eye."
    sources = r.json()["web_sources"]
    assert [s["url"] for s in sources] == ["https://harbourline.example/team", "https://news.example/harbourline-leeds"]
    assert "jane.doe@harbourline.example" in sources[0]["excerpt"]
    # Queries are written by code from the row; searches run on the small model.
    queries = [c.args[0] for c in stub.generate_with_web.await_args_list]
    assert queries == ["Harbourline Supply harbourline.example leadership team", '"@harbourline.example" email contact']
    assert stub.generate_with_web.await_args.kwargs["model"] == "anthropic/claude-haiku-5.5"


def test_an_address_a_page_shows_is_verified_and_an_invented_one_is_dropped():
    _stub({"rows": [{"id": "c1", "name": "Morgan Reyes", "name_page": 1, "email": "info@harbourline.example", "email_page": 1}]})
    row = _post([ROW]).json()["rows"][0]
    assert (row["email"], row["email_status"], row["src_email"]) == ("info@harbourline.example", "verified", "[S1]")
    assert inbox_kind(row["email"]) == "general"

    _stub({"rows": [{"id": "c1", "name": "Ana Nobody", "name_page": 1, "email": "ana@harbourline.example", "email_page": 1}]})
    row = _post([ROW]).json()["rows"][0]
    # Nobody on the pages is called Ana Nobody, and no page shows the address.
    assert row["name"] == "" and row["email"] == "" and row["email_status"] == "none"
    assert row["reason"]


def test_a_detail_not_on_its_page_is_dropped_with_its_line():
    _stub({"rows": [{"id": "c1", "detail": "Harbourline raised 40 million dollars from investors in Singapore", "detail_page": 2, "personal_line": "Congratulations on the raise."}]})
    row = _post([dict(ROW, name="Morgan Reyes", email="morgan@harbourline.example")]).json()["rows"][0]
    assert row["detail"] == "" and row["personal_line"] == ""


def test_candidates_need_their_page_and_a_reason():
    _stub({"rows": [{"id": "c1", "candidates": [
        {"name": "Morgan Reyes", "role": "Head of Operations", "why": "Runs the Leeds hub.", "page": 1},
        {"name": "Pat Invented", "role": "COO", "why": "Senior.", "page": 1},
        {"name": "Jane Doe", "role": "Communications", "why": "", "page": 1},
    ]}]})
    row = _post([ROW]).json()["rows"][0]
    assert [c["name"] for c in row["candidates"]] == ["Morgan Reyes"]


def test_values_the_list_has_are_never_replaced_or_searched_for():
    stub = _stub({"rows": [{"id": "c1", "name": "Someone Else", "name_page": 1, "email": "info@harbourline.example", "email_page": 1}]})
    given = dict(ROW, name="Morgan Reyes", role="COO", email="morgan@harbourline.example", detail="Leeds hub")
    row = _post([given]).json()["rows"][0]
    assert row["name"] == "" and row["email"] == "" and row["email_status"] == ""
    assert stub.generate_with_web.await_count == 0


def test_refused_while_web_access_is_off():
    stub = _stub({"rows": []})
    r = _post([ROW], web_access="off")
    assert r.status_code == 409 and "Web access" in r.json()["detail"]
    stub.generate_with_web.assert_not_called()


def test_nothing_found_says_so():
    stub = _stub({"rows": []}, pages_by_query=lambda q: [])
    row = _post([ROW]).json()["rows"][0]
    assert row["reason"] == "No page found names a person or shows an address."
    stub.generate_json.assert_not_called()


def test_the_prompt_lists_each_pages_addresses_and_asks_for_no_guessing():
    rows = [ResearchRow(**ROW)]
    from promptmaster.outreach_research import Page

    long_text = "x " * 3_000 + "Write to ops@harbourline.example"
    prompt = build_read_prompt(PMInput(**INPUTS), "Write to the head of operations.", rows, {"c1": [Page(url="https://a.example", title="A", text=long_text)]})
    assert "Addresses on this page: ops@harbourline.example" in prompt  # though past the shown text
    assert "Never complete or guess an address" in prompt
    assert "Write to the head of operations." in prompt and "CONTACT id=c1" in prompt


def test_patterns():
    assert pattern_of("jane.doe@acme.example", "Jane Doe") == "first.last"
    assert pattern_of("jdoe@acme.example", "Jane Doe") == "flast"
    assert pattern_of("press@acme.example", "Jane Doe") == ""
    assert apply_pattern("first.last", "Morgan Reyes", "acme.example") == "morgan.reyes@acme.example"
    assert queries_for(ResearchRow(id="x", company="Acme", domain="acme.example", name="Jo Bloggs")) == [
        '"Jo Bloggs" Acme',
        '"Jo Bloggs" "@acme.example" email',
    ]


def test_go_can_research_and_draft_an_outreach_round_but_never_approve_or_send():
    from promptmaster.agent_actions import ACTION_KEYS, AGENT_ACTIONS

    assert {"research_contacts", "draft_outreach"} <= ACTION_KEYS
    when = {a.key: a.when for a in AGENT_ACTIONS}
    assert "keeps only what a page shows" in when["research_contacts"]
    assert "Never approves or sends" in when["draft_outreach"]
    assert not any(k for k in ACTION_KEYS if "send" in k or "approve" in k)
