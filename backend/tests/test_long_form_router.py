"""Endpoint tests for routers/long_form.py."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_client


@pytest.fixture
def client_for_app():
    """FastAPI TestClient with dependency override."""
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _basic_inputs_dict():
    return {
        "objective": "Plan a launch strategy for an internal tool.",
        "audience": "Engineering leads",
        "constraints": "Two-week timeline",
        "output_format": "Numbered list",
        "mode": "architect",
    }


def test_detect_endpoint_returns_classifier_result(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_json = AsyncMock(return_value=(
        {"is_long_form": True, "suggested_section_count": 8, "reason": "Multi-section plan"},
        {},
    ))
    r = api_client.post("/api/detect-long-form", json={"inputs": _basic_inputs_dict()})
    assert r.status_code == 200
    body = r.json()
    assert body["is_long_form"] is True
    assert body["suggested_section_count"] == 8


def test_generate_outline_endpoint_returns_sections(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_json = AsyncMock(return_value=(
        {"outline": [
            {"title": "Intro", "abstract": "a"},
            {"title": "Body", "abstract": "b"},
        ]},
        {},
    ))
    r = api_client.post("/api/generate-outline", json={
        "inputs": _basic_inputs_dict(),
        "suggested_section_count": 2,
    })
    assert r.status_code == 200
    body = r.json()
    assert len(body["outline"]) == 2
    assert body["outline"][0]["title"] == "Intro"
    assert body["outline"][0]["status"] == "pending"


def test_generate_section_endpoint_returns_content_and_snapshot(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_with_meta = AsyncMock(return_value=("Section prose.", {}, "stop"))
    mock_llm.generate_json = AsyncMock(return_value=(
        {"completed_topics": ["Body"], "current_topic": None, "key_definitions": [], "next_topic_hint": None},
        {},
    ))
    r = api_client.post("/api/generate-section", json={
        "inputs": _basic_inputs_dict(),
        "outline": [
            {"id": "s1", "title": "Body", "abstract": "b"},
        ],
        "section_index": 0,
        "prior_snapshot": None,
        "prev_section_content": "",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "Section prose."
    assert body["finish_reason"] == "stop"
    assert "new_snapshot" in body


def test_finalize_endpoint_returns_iteration_with_eval(client_for_app):
    api_client, mock_llm = client_for_app

    # Mock the parallel calls: evaluator (generate_json), suggestions (generate), summary (generate)
    mock_llm.generate_json = AsyncMock(return_value=(
        {
            "alignment": {"score": "High", "explanation": "On target."},
            "clarity": {"score": "High", "explanation": "Clear."},
            "drift": {"score": "Low", "explanation": "Focused."},
            "completeness": {"status": "complete", "reason": ""},
        },
        {},
    ))
    mock_llm.generate = AsyncMock(return_value=("- Suggestion 1\n- Suggestion 2", {}))

    r = api_client.post("/api/finalize-long-form", json={
        "inputs": _basic_inputs_dict(),
        "merged_content": "Full merged document content.",
        "outline": [
            {"id": "s1", "title": "A", "abstract": "a", "status": "complete", "content": "Full merged document content."},
        ],
        "iteration_number": 1,
        "iteration_history": [],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["iteration"]["trigger_source"] == "long_form_finalize"
    assert body["iteration"]["output"] == "Full merged document content."
    assert body["iteration"]["evaluation"]["alignment"]["score"] == "High"


# ---------------------------------------------------------------------------
# The split endpoints (FR-05)
# ---------------------------------------------------------------------------

def test_generate_section_prose_returns_only_prose(client_for_app):
    """One call, no continuity work. The drain commits this before doing more."""
    api_client, mock_llm = client_for_app
    mock_llm.generate_with_meta = AsyncMock(return_value=("Section prose.", {}, "stop"))
    mock_llm.generate_json = AsyncMock(side_effect=AssertionError("must not extract"))

    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Body", "abstract": "b"}],
        "section_index": 0,
    })
    assert r.status_code == 200
    assert r.json() == {"content": "Section prose.", "finish_reason": "stop"}


def test_generate_section_prose_rejects_out_of_range_index(client_for_app):
    api_client, _ = client_for_app
    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Body", "abstract": "b"}],
        "section_index": 4,
    })
    assert r.status_code == 400


def test_generate_section_prose_accepts_records(client_for_app):
    api_client, mock_llm = client_for_app
    captured = {}

    async def _capture(**kwargs):
        captured.update(kwargs)
        return ("prose", {}, "stop")

    mock_llm.generate_with_meta = _capture
    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [
            {"id": "s1", "title": "Intro", "abstract": "a"},
            {"id": "s2", "title": "Body", "abstract": "b"},
        ],
        "section_index": 1,
        "records": [{
            "section_id": "s1", "section_index": 0, "title": "Intro",
            "summary": "RECORD-SUMMARY-MARKER",
            "glossary_terms": [{"term": "GLOSSARY-MARKER", "definition": "d"}],
            "decisions": ["DECISION-MARKER"], "todos": ["TODO-MARKER"],
        }],
    })
    assert r.status_code == 200
    prompt = captured["prompt"]
    for marker in ("RECORD-SUMMARY-MARKER", "GLOSSARY-MARKER", "DECISION-MARKER", "TODO-MARKER"):
        assert marker in prompt


def test_extract_section_record_endpoint(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_json = AsyncMock(return_value=(
        {
            "summary": "It set the terms.",
            "glossary_terms": [{"term": "lease", "definition": "A claim that expires."}],
            "decisions": ["Job-based drafting."],
            "todos": ["Cover cancellation."],
        },
        {},
    ))
    r = api_client.post("/api/extract-section-record", json={
        "section_id": "s1", "section_index": 0,
        "section_title": "Foundations", "section_content": "body",
        "existing_terms": ["drain"],
    })
    assert r.status_code == 200
    record = r.json()["record"]
    assert record["summary"] == "It set the terms."
    assert record["glossary_terms"][0]["term"] == "lease"
    assert record["section_id"] == "s1"


def test_extract_section_record_rejects_empty_content(client_for_app):
    api_client, _ = client_for_app
    r = api_client.post("/api/extract-section-record", json={
        "section_id": "s1", "section_index": 0, "section_content": "   ",
    })
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Truncation detection at the document boundary
# ---------------------------------------------------------------------------

def _finalize_mocks(mock_llm):
    mock_llm.generate_json = AsyncMock(return_value=(
        {
            "alignment": {"score": "High", "explanation": "On target."},
            "clarity": {"score": "High", "explanation": "Clear."},
            "drift": {"score": "Low", "explanation": "Focused."},
            "completeness": {"status": "complete", "reason": ""},
        },
        {},
    ))
    mock_llm.generate = AsyncMock(return_value=("- Suggestion", {}))


def test_finalize_marks_document_incomplete_when_a_section_was_truncated(client_for_app):
    """The evaluator said 'complete'; a section that hit the token limit overrides it.

    This is the bug the hardcoded finish_reason="stop" hid: a document with a
    section cut off mid-sentence was merged and then declared finished.
    """
    api_client, mock_llm = client_for_app
    _finalize_mocks(mock_llm)

    r = api_client.post("/api/finalize-long-form", json={
        "inputs": _basic_inputs_dict(),
        "merged_content": "Merged document.",
        "outline": [
            {"id": "s1", "title": "A", "abstract": "a", "status": "complete",
             "content": "x", "finish_reason": "stop"},
            {"id": "s2", "title": "B", "abstract": "b", "status": "complete",
             "content": "y", "finish_reason": "length"},
        ],
        "iteration_number": 1,
        "iteration_history": [],
    })
    assert r.status_code == 200
    assert r.json()["iteration"]["evaluation"]["completeness"]["status"] == "incomplete"


def test_finalize_stays_complete_when_no_section_was_truncated(client_for_app):
    api_client, mock_llm = client_for_app
    _finalize_mocks(mock_llm)

    r = api_client.post("/api/finalize-long-form", json={
        "inputs": _basic_inputs_dict(),
        "merged_content": "Merged document.",
        "outline": [
            {"id": "s1", "title": "A", "abstract": "a", "status": "complete",
             "content": "x", "finish_reason": "stop"},
        ],
        "iteration_number": 1,
        "iteration_history": [],
    })
    assert r.status_code == 200
    assert r.json()["iteration"]["evaluation"]["completeness"]["status"] == "complete"
