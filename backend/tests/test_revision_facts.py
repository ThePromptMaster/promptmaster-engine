"""A revision that changes a fact in meaning, not by a value (L-72, 11 Oct:
an onboarding plan moved from an in-office team to a fully remote one)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.revision_facts import RevisionFact, RevisionFactsRequest, build_prompt, parse

AFTER = "Day one happens on video. The team works fully remote, so laptops ship to the new hire's home."
REQ = RevisionFactsRequest(
    instruction="Make the employee fully remote.",
    before="Day one happens at the office. The team works in-office.",
    after=AFTER,
    facts=[RevisionFact(id="f1", statement="The team is five people, initially in-office."), RevisionFact(id="f2", statement="Six sections.")],
)


def test_the_prompt_asks_only_for_facts_the_instruction_changes():
    system, user = build_prompt(REQ)
    assert "Report ONLY a fact that the user's INSTRUCTION changes" in system
    assert "- [f1] The team is five people, initially in-office." in user
    assert "THE REVISED TEXT:\n" + AFTER in user


def test_a_change_is_kept_only_for_a_listed_fact_with_a_verbatim_quote():
    out = parse({"changes": [
        {"fact_id": "f1", "proposed": "The team is five people, fully remote.", "quote": "The team works fully remote", "why": "remote"},
        {"fact_id": "f9", "proposed": "x", "quote": "The team works fully remote"},
        {"fact_id": "f2", "proposed": "Seven sections.", "quote": "the plan has seven sections"},
        {"fact_id": "f1", "proposed": "dup", "quote": "Day one happens on video."},
    ]}, REQ)
    assert [(c.fact_id, c.proposed) for c in out.changes] == [("f1", "The team is five people, fully remote.")]


def test_the_endpoint_reports_nothing_when_the_check_fails():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/revision-facts", json=REQ.model_dump())
        assert r.status_code == 200 and r.json() == {"changes": []}
    finally:
        app.dependency_overrides.pop(get_client, None)
