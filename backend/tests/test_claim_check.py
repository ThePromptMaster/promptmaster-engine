"""A revision that adds personal details the user never supplied (14 Oct,
Sean's wedding speech: "a lifelong pattern of Emma being the organized one")."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.claim_check import NewClaimsRequest, build_prompt, parse

SUPPLIED = (
    "Emma made her older brother rehearse school presentations with her and corrected him when he skipped a line. "
    "They joke that she was his first boss. Emma is thoughtful and dependable."
)
BEFORE = "When we were kids, Emma used to make me rehearse her school presentations with her. And if I skipped a line, she corrected me straight away."
AFTER = (
    "When we were kids, Emma used to make me rehearse her school presentations with her. And if I skipped a line, "
    "she’d stop me straight away and make me do it properly. Honestly, that was probably the beginning of a lifelong "
    "pattern of Emma being the organized one and me just trying to keep up."
)
REQ = NewClaimsRequest(before=BEFORE, after=AFTER, supplied=SUPPLIED, instruction="Add no new personal details.")


def test_the_prompt_separates_restyling_from_new_claims():
    system, user = build_prompt(REQ)
    assert "embellishment of a supplied event" in system
    assert "Do NOT report: a rewording or paraphrase of something supplied" in system
    assert "the speaker's own impressions, feelings or praise" in system
    assert "WHAT THE USER SUPPLIED:\n" + SUPPLIED in user
    assert "THE REVISED TEXT:\n" + AFTER in user


def test_a_claim_is_kept_only_when_new_and_quoted_verbatim():
    out = parse({"claims": [
        {"quote": "a lifelong pattern of Emma being the organized one and me just trying to keep up", "why": "not supplied"},
        {"quote": "make me do it properly", "why": "embellishes the correction"},
        {"quote": "Emma used to make me rehearse her school presentations", "why": "already there"},
        {"quote": "Emma climbed Everest", "why": "not in the text"},
        {"quote": "make me do it properly", "why": "duplicate"},
    ]}, REQ)
    assert [c.quote for c in out.claims] == [
        "a lifelong pattern of Emma being the organized one and me just trying to keep up",
        "make me do it properly",
    ]


def test_the_endpoint_reports_nothing_when_the_check_fails():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/check-new-claims", json=REQ.model_dump())
        assert r.status_code == 200 and r.json() == {"claims": []}
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_the_endpoint_returns_parsed_claims():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"claims": [{"quote": "make me do it properly", "why": "x"}]}, None))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/check-new-claims", json=REQ.model_dump())
        assert r.json() == {"claims": [{"quote": "make me do it properly", "why": "x"}]}
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_a_quote_in_guillemets_is_kept():
    """Client, 21 Oct ("pick your language"): a French check quotes « like this »."""
    req = NewClaimsRequest(
        before="Emma corrigeait mon texte.",
        after="Emma corrigeait mon texte. « Elle a toujours été la plus organisée de la famille. »",
        supplied="Emma corrigeait mon texte.",
        instruction="",
    )
    out = parse({"claims": [{"quote": "« Elle a toujours été la plus organisée de la famille. »", "why": "pas fourni"}]}, req)
    assert [c.quote for c in out.claims] == ["Elle a toujours été la plus organisée de la famille."]
