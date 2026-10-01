"""Established figures (1 Oct feedback, item 32): only what the text itself says."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.figures import MAX_FIGURES, build_figures_prompt, extract_figures, parse_figures
from promptmaster.schemas import EstablishedFigure, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt

TEXT = "Mid-Market churn rose from 4.1% to 9.4% over two quarters.\nOf 240 accounts,  114 are Mid-Market and 10 churned."


def test_the_prompt_forbids_computing_or_rounding():
    system, user = build_figures_prompt("Analysis", TEXT)
    assert "Copy each value EXACTLY as it is written" in system
    assert "Never compute, round, convert or combine values" in system
    assert "A value that is not in the text is not a figure" in system
    assert "9.4%" in user


def test_a_value_is_kept_only_if_the_text_contains_it_exactly():
    raw = {"figures": [
        {"name": "Churn after", "value": "9.4%", "context": "Mid-Market"},
        {"name": "Churn change", "value": "5.3 points"},          # computed: not in the text
        {"name": "Churn after, rounded", "value": "9%"},          # rounded: not in the text
        {"name": "Mid-Market accounts", "value": "114"},
        {"name": "Trend", "value": "significant"},                # no digit
        {"name": "", "value": "240"},                             # no name
        {"name": "Churn after", "value": "9.4%"},                 # duplicate
    ]}
    kept = parse_figures(raw, TEXT)
    assert [(f.name, f.value) for f in kept] == [("Churn after", "9.4%"), ("Mid-Market accounts", "114")]
    assert kept[0].context == "Mid-Market"


def test_whitespace_in_the_text_does_not_hide_a_value_and_the_list_is_capped():
    assert [f.value for f in parse_figures({"figures": [{"name": "Counts", "value": "240 accounts, 114 are Mid-Market"}]}, TEXT)] == [
        "240 accounts, 114 are Mid-Market"
    ]
    many = {"figures": [{"name": f"n{i}", "value": "240"} for i in range(30)]}
    assert len(parse_figures(many, TEXT)) == MAX_FIGURES
    assert parse_figures("nope", TEXT) == []


@pytest.mark.asyncio
async def test_text_with_no_digits_costs_no_call():
    client = AsyncMock()
    assert await extract_figures(client, None, "Objective", "A book about giraffes, for children.") == []
    client.generate_json.assert_not_called()


def test_a_later_stage_is_told_to_quote_the_figures_not_recompute_them(basic_inputs):
    digest = StageDigest(objective="o", figures=[
        EstablishedFigure(stage="Analysis", name="Mid-Market churn rate, Q2", value="9.4%", context="of 114 accounts"),
    ])
    stage = StageDescriptor(id="validation", label="Validation", renderer="prose", entry_prompt_hint="", artifact_kind="validation")
    _, user = build_stage_prompt(basic_inputs, stage, digest)
    assert "FIGURES ALREADY ESTABLISHED by earlier stages" in user
    assert "use this exact value: do not recompute it" in user
    assert "say so in words, naming both values, as a discrepancy" in user
    assert "- [Analysis] Mid-Market churn rate, Q2: 9.4% (of 114 accounts)" in user
    _, without = build_stage_prompt(basic_inputs, stage, StageDigest(objective="o"))
    assert "FIGURES ALREADY ESTABLISHED" not in without


def test_the_route_returns_only_what_the_text_holds():
    client = AsyncMock()
    client.generate_json.return_value = ({"figures": [{"name": "After", "value": "9.4%"}, {"name": "Made up", "value": "12%"}]}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/extract-figures", json={"stage_label": "Analysis", "content": TEXT})
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json()["figures"] == [{"name": "After", "value": "9.4%", "context": ""}]
