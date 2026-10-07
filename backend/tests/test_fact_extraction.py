"""Facts read out of attached documents, quoted from their source (7 Oct, L-51)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.fact_extraction import SourceDoc, build_extraction_prompt, parse_extraction
from promptmaster.schemas import AcceptedFact, PMInput

SRC = [SourceDoc(id="brief.pdf", label="brief.pdf", text="Northstar board brief. Gross margin fell from 31.2% to 24.8% in FY2025. The plant in Leeds closes in March.")]


def test_only_what_the_document_states_is_asked_for():
    system, user = build_extraction_prompt(PMInput(objective="Explain the margin", mode="analyst"), SRC)
    assert "never an inference, a calculation, an opinion or a recommendation" in system
    assert "--- SOURCE id=brief.pdf: brief.pdf ---" in user


def test_a_fact_needs_a_verbatim_quote_and_its_figures_in_it():
    raw = {"facts": [
        {"statement": "Gross margin fell from 31.2% to 24.8% in FY2025", "source_id": "brief.pdf", "quote": "Gross margin fell from 31.2% to 24.8% in FY2025."},
        {"statement": "Margin fell 6.4 points", "source_id": "brief.pdf", "quote": "Gross margin fell from 31.2% to 24.8% in FY2025."},
        {"statement": "Revenue grew 9%", "source_id": "brief.pdf", "quote": "Revenue grew 9% last year."},
        {"statement": "The Leeds plant closes in March", "source_id": "other.pdf", "quote": "The plant in Leeds closes in March."},
        {"statement": "The Leeds plant closes in March", "source_id": "brief.pdf", "quote": "The plant in Leeds closes in March."},
    ]}
    out = parse_extraction(raw, SRC, existing=["The Leeds plant closes in March"])
    assert [f.statement for f in out] == ["Gross margin fell from 31.2% to 24.8% in FY2025"]


def test_endpoint_returns_quoted_facts_and_records_nothing():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"facts": [{"statement": "The plant in Leeds closes in March", "source_id": "brief.pdf", "quote": "The plant in Leeds closes in March."}]}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/agent/extract-facts", json={
            "inputs": PMInput(objective="o", mode="analyst", facts=[AcceptedFact(statement="x")]).model_dump(),
            "sources": [s.model_dump() for s in SRC]})
        assert r.status_code == 200, r.text
        assert r.json()["facts"][0]["source_id"] == "brief.pdf"
    finally:
        app.dependency_overrides.pop(get_client, None)
