"""Terms a text attaches to an amount or item, checked against what was supplied (4 Nov).

Sean's support-software memo (final v3): "$3,380 ($500 + $2,880), nonrefundable"
and "B locks in $3,380, nonrefundable", where the supplied facts said only "The
annual subscription payment is nonrefundable." — the $2,880 — and gave no terms
for the $500 setup fee. The arithmetic was right; the attribute was not, and
neither the check nor a manual recheck caught it. Final v4 is the side chat's
correction of the same memo.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.claim_support import ClaimSupportRequest, build_prompt, parse

FIX = Path(__file__).parent / "fixtures" / "support_memo"
V3 = (FIX / "final_v3.md").read_text()
V4 = (FIX / "final_v4.md").read_text()
SUPPLIED = (FIX / "supplied.txt").read_text()
REQ = ClaimSupportRequest(stage_label="Final decision memo", text=V3, supplied=SUPPLIED)

WRONG = "$3,380 ($500 + $2,880), nonrefundable"
FACT = "The annual subscription payment is nonrefundable."


def test_the_fixture_is_the_wrong_memo_and_its_correction():
    assert WRONG in V3 and WRONG not in V4
    assert "B locks in $3,380, nonrefundable" in V3
    assert FACT in SUPPLIED and "$500 one-time setup fee." in SUPPLIED


def test_the_prompt_asks_about_terms_attached_to_the_wrong_amount():
    system, user = build_prompt(REQ)
    assert "a term stated of a whole when the supplied material gives it for only a part" in system
    assert "nonrefundable or refundable" in system
    assert "Do NOT report: a figure or calculation (only the term attached to it)" in system
    assert "WHAT THE USER SUPPLIED:" in user and FACT in user
    assert "THE TEXT (Final decision memo):" in user and WRONG in user


def test_a_claim_is_kept_only_with_its_quotes_verbatim():
    raw = {"claims": [
        {"quote": WRONG, "supplied": FACT, "why": "Only the $2,880 subscription is nonrefundable; the setup fee's terms are not given."},
        {"quote": "B locks in $3,380, nonrefundable", "supplied": "", "why": "Nothing supplied says the setup fee is nonrefundable."},
        # Not in the text: dropped.
        {"quote": "All of option B is refundable", "supplied": FACT, "why": "x"},
        # A supplied passage that was never supplied: dropped.
        {"quote": "Monthly, cancellable", "supplied": "Monthly billing, cancellable at any time.", "why": "x"},
        # Says what was supplied, word for word: supported.
        {"quote": "All 12 agents need seats", "supplied": "", "why": "x"},
        {"quote": WRONG, "supplied": FACT, "why": "duplicate"},
    ]}
    out = parse(raw, ClaimSupportRequest(stage_label="m", text=V3 + "\nMonthly, cancellable. All 12 agents need seats.", supplied=SUPPLIED))
    assert [c.quote for c in out.claims] == [WRONG, "B locks in $3,380, nonrefundable"]
    assert out.claims[0].supplied == FACT
    assert out.claims[1].supplied == ""


def test_garbage_and_failures_report_nothing():
    assert parse("nope", REQ).claims == []
    assert parse({"claims": "x"}, REQ).claims == []


def test_the_endpoint_returns_the_held_claims_and_says_what_it_checks():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"claims": [{"quote": WRONG, "supplied": FACT, "why": "part, not whole"}]}, None))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/claim-support", json=REQ.model_dump())
        assert r.status_code == 200
        assert r.json()["claims"][0]["quote"] == WRONG
        _, kwargs = stub.generate_json.call_args
        assert "WHAT THE USER SUPPLIED" in kwargs["prompt"]
    finally:
        app.dependency_overrides.pop(get_client, None)


def test_a_failed_call_reports_nothing():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/claim-support", json=REQ.model_dump())
        assert r.status_code == 200 and r.json() == {"claims": []}
    finally:
        app.dependency_overrides.pop(get_client, None)
