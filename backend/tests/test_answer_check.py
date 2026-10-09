"""L-65 (9 Oct): an answer's claims about the saved record are read against it."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.answer_check import AnswerDocument, CheckAnswerRequest, build_prompt, check_answer, parse

EXPERIMENT = "Cycle 3 explicit check at n = 5 | not run — a_7 was not present [status: not_run]"
REQ = CheckAnswerRequest(
    question="The objective is not met yet: the n = 5 check is procedurally open.",
    answer="The Experiment run record contains S_5 = 12 = a_7 - 1; there is no provenance issue.",
    documents=[
        AnswerDocument(label="Experiment or investigation", version=1, text=EXPERIMENT),
        AnswerDocument(label="Analysis", version=2, text="S_5 = 0+1+1+2+3+5 = 12 = a_7 - 1."),
    ],
)


def test_the_prompt_carries_the_answer_and_every_document_and_spares_decisions():
    system, prompt = build_prompt(REQ)
    assert "Ignore decisions, choices, preferences, instructions and new values" in system
    assert "THE USER'S ANSWER:\nThe Experiment run record contains S_5" in prompt
    assert "--- DOCUMENT: Experiment or investigation (v1) ---" in prompt and "--- DOCUMENT: Analysis (v2) ---" in prompt


def test_a_contradiction_is_kept_only_with_a_verbatim_quote_from_the_named_document():
    found = parse({"contradicts": True, "document": "Experiment or investigation",
                   "quote": "Cycle 3 explicit check at n = 5 | not run", "claim": "contains S_5 = 12"}, REQ)
    assert found.contradicts and found.document == "Experiment or investigation" and found.version == 1
    # Paraphrased, from another document, or from one never sent: nothing to show.
    assert not parse({"contradicts": True, "document": "Experiment or investigation", "quote": "the n=5 check was skipped"}, REQ).contradicts
    assert not parse({"contradicts": True, "document": "Analysis", "quote": "Cycle 3 explicit check at n = 5 | not run"}, REQ).contradicts
    assert not parse({"contradicts": True, "document": "Summary", "quote": "Cycle 3 explicit check at n = 5"}, REQ).contradicts
    assert not parse({"contradicts": False}, REQ).contradicts


@pytest.mark.asyncio
async def test_a_failed_check_never_stands_between_the_user_and_their_answer():
    client = AsyncMock()
    client.generate_json.side_effect = RuntimeError("model down")
    assert (await check_answer(client, REQ)).contradicts is False
    # No documents: nothing to check, and no call.
    client.generate_json.reset_mock()
    assert (await check_answer(client, CheckAnswerRequest(answer="Dec 10", documents=[]))).contradicts is False
    client.generate_json.assert_not_called()


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def test_the_route_answers(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_json.return_value = (
        {"contradicts": True, "document": "Experiment or investigation", "quote": "Cycle 3 explicit check at n = 5 | not run"}, {})
    r = api_client.post("/api/agent/check-answer", json=REQ.model_dump())
    assert r.status_code == 200
    assert r.json()["contradicts"] is True and r.json()["quote"].startswith("Cycle 3 explicit check")
