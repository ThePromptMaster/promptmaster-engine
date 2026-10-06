"""PromptMaster reads a source's abstract before asking the user to verify it (Sean, 5 Oct)."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.verify_sources import (
    SourceToVerify,
    abstract_from_index,
    build_verify_prompt,
    index_key,
    parse_verdicts,
    quote_is_in,
    verify_sources,
)

ABSTRACT = "Pendulum clocks lose time as temperature rises. We show that thermal expansion of the rod explains 90% of the drift."


def test_the_abstract_is_put_back_in_order():
    assert abstract_from_index({"world": [1], "Hello": [0], "again": [3], "hello": [2]}) == "Hello world hello again"
    assert abstract_from_index(None) == ""


def test_a_link_becomes_an_index_address():
    assert index_key("https://doi.org/10.1038/nature12373") == "https://doi.org/10.1038/nature12373"
    assert index_key("doi:10.1000/xyz123.") == "https://doi.org/10.1000/xyz123"
    assert index_key("https://openalex.org/W2741809807") == "W2741809807"
    assert index_key("https://example.com/blog") is None


def test_the_quote_must_be_in_the_abstract():
    assert quote_is_in("We show that thermal expansion of the rod explains 90% of the drift", ABSTRACT)
    assert quote_is_in("we show that THERMAL expansion of the rod explains 90% of the drift.", ABSTRACT)
    assert not quote_is_in("Thermal expansion explains all of the drift.", ABSTRACT)
    assert not quote_is_in("rod", ABSTRACT)


def test_a_verdict_without_a_real_quote_says_nothing():
    out = parse_verdicts({"verdicts": [
        {"id": "a", "verdict": "supports", "quote": "We show that thermal expansion of the rod explains 90% of the drift."},
        {"id": "b", "verdict": "supports", "quote": "Thermal expansion explains everything."},
        {"id": "c", "verdict": "weird"},
        {"id": "zz", "verdict": "supports", "quote": "x"},
    ]}, {"a": ABSTRACT, "b": ABSTRACT, "c": ABSTRACT})
    assert out["a"].verdict == "supports" and out["a"].basis == "abstract"
    assert out["b"].verdict == "cannot_tell" and "could not point to a sentence" in out["b"].note
    assert out["c"].verdict == "cannot_tell"
    assert "zz" not in out


def test_the_prompt_judges_only_from_the_abstract(basic_inputs):
    system, user = build_verify_prompt(basic_inputs, [(SourceToVerify(id="a", claim="Expansion explains the drift"), ABSTRACT)])
    assert "Judge ONLY from the abstract" in system
    assert "Never quote anything that is not in the abstract" in system
    assert "ITEM id=a" in user and ABSTRACT in user


@pytest.mark.asyncio
async def test_a_source_with_no_abstract_is_not_sent_to_the_model(basic_inputs):
    client = AsyncMock()
    client.generate_json.return_value = ({"verdicts": [{"id": "a", "verdict": "supports", "quote": "This study shows the effect holds in every case examined."}]}, {})
    out = await verify_sources(client, None, basic_inputs, [
        SourceToVerify(id="a", claim="It holds", link="https://doi.org/10.0000/mock.1"),
        SourceToVerify(id="b", claim="It holds", link="https://doi.org/10.0000/mock.2"),
    ], mock=True)
    assert [v.verdict for v in out] == ["supports", "cannot_tell"]
    assert "needs reading in full" in out[1].note
    prompt = client.generate_json.call_args.kwargs["prompt"]
    assert "ITEM id=a" in prompt and "ITEM id=b" not in prompt


def test_the_route_returns_one_verdict_per_source(basic_inputs):
    client = AsyncMock()
    client.generate_json.return_value = ({"verdicts": []}, {})
    app.dependency_overrides[get_client] = lambda: client
    try:
        res = TestClient(app).post("/api/agent/verify-sources", json={
            "inputs": basic_inputs.model_dump(), "sources": [{"id": "a", "claim": "c", "link": "https://example.com"}],
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert res.status_code == 200
    assert res.json()["verdicts"] == [{"id": "a", "verdict": "cannot_tell", "quote": "", "basis": "none", "note": "No DOI or index record on the row to read."}]
    client.generate_json.assert_not_called()
