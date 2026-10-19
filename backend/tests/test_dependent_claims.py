"""A conclusion that no longer follows from a corrected fact (18 Oct, Sean,
Summit: "EBITDA deterioration despite higher revenue" after revenue fell)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.dependent_claims import ChangedFact, DependentClaimsRequest, build_prompt, parse

PACK = (
    "## Executive summary\n"
    "Current-quarter revenue was $22.5 million against a $26 million budget. EBITDA was $2.7 million.\n\n"
    "## Supported inferences\n"
    "- EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap.\n"
    "- Previously reported revenue of $24 million was corrected by the CFO.\n"
)
REQ = DependentClaimsRequest(
    stage_label="Finished quarterly review pack",
    text=PACK,
    changed=[ChangedFact(statement="Current-quarter revenue was $22.5 million, below the previous quarter's $23 million.",
                         replaces="Current-quarter revenue was $24 million.")],
    facts=["The board authorized the process-improvement analysis."],
)


def test_the_prompt_asks_for_conclusions_not_figures():
    system, user = build_prompt(REQ)
    assert "conclusion, comparison, direction or explanation no longer follows" in system
    assert "despite higher revenue" in system
    assert "records history on purpose" in system
    assert "(replaces: Current-quarter revenue was $24 million.)" in user
    assert "THE TEXT (Finished quarterly review pack):\n" + PACK.strip() in user


def test_a_claim_is_kept_only_when_quoted_verbatim():
    out = parse({"claims": [
        {"quote": "EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap.",
         "fact": "Revenue was $22.5 million", "why": "revenue fell"},
        {"quote": "Revenue rose strongly this quarter", "why": "not in the text"},
        {"quote": "EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap.", "why": "duplicate"},
        "junk",
    ]}, REQ)
    assert [c.quote for c in out.claims] == ["EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap."]
    assert out.claims[0].why == "revenue fell"


def test_the_endpoint_makes_no_call_without_a_changed_fact_and_reports_nothing_on_failure():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        client = TestClient(app)
        r = client.post("/api/dependent-claims", json=REQ.model_copy(update={"changed": []}).model_dump())
        assert r.status_code == 200 and r.json() == {"claims": []}
        stub.generate_json.assert_not_called()
        r = client.post("/api/dependent-claims", json=REQ.model_dump())
        assert r.status_code == 200 and r.json() == {"claims": []}
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_the_endpoint_returns_the_held_claims():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"claims": [
        {"quote": "EBITDA deterioration despite higher revenue suggests margin pressure from overtime and scrap.", "fact": "f", "why": "w"},
    ]}, None))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/dependent-claims", json=REQ.model_dump())
        assert r.json()["claims"][0]["quote"].startswith("EBITDA deterioration despite higher revenue")
        _, kwargs = stub.generate_json.call_args
        assert "FACTS THAT CHANGED" in kwargs["prompt"]
    finally:
        app.dependency_overrides.pop(get_client, None)
