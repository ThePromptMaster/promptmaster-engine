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


# ---------------------------------------------------------------------------
# PM-04: a section must not outlive the function that asked for it
# ---------------------------------------------------------------------------

def test_section_prose_turns_the_callers_budget_into_a_deadline(client_for_app):
    """Without a deadline the provider retry ladder (3 x 55s) outlived the
    drain's function, which was killed mid-call and lost paid-for prose."""
    import time

    api_client, mock_llm = client_for_app
    mock_llm.generate_with_meta = AsyncMock(return_value=("Section prose.", {}, "stop"))

    before = time.monotonic()
    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Body", "abstract": "b"}],
        "section_index": 0,
        "budget_seconds": 120,
    })
    assert r.status_code == 200
    deadline = mock_llm.generate_with_meta.await_args.kwargs["deadline"]
    assert before + 119 < deadline <= time.monotonic() + 120


def test_section_prose_without_a_budget_keeps_the_old_behaviour(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_with_meta = AsyncMock(return_value=("Section prose.", {}, "stop"))
    api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Body", "abstract": "b"}],
        "section_index": 0,
    })
    assert mock_llm.generate_with_meta.await_args.kwargs["deadline"] is None


def test_running_out_of_budget_is_reported_as_function_timeout(client_for_app):
    """The drain reads this code and hands the job back without spending an attempt."""
    from promptmaster.llm_client import OpenRouterDeadlineError

    api_client, mock_llm = client_for_app
    mock_llm.generate_with_meta = AsyncMock(side_effect=OpenRouterDeadlineError("out of time"))
    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Body", "abstract": "b"}],
        "section_index": 0,
        "budget_seconds": 5,
    })
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "function_timeout"


def test_record_extraction_also_honours_the_budget(client_for_app):
    api_client, mock_llm = client_for_app
    mock_llm.generate_json = AsyncMock(return_value=({"summary": "s"}, {}))
    api_client.post("/api/extract-section-record", json={
        "section_id": "s1",
        "section_index": 0,
        "section_content": "Some prose.",
        "budget_seconds": 30,
    })
    assert mock_llm.generate_json.await_args.kwargs["deadline"] is not None


def test_section_prose_with_a_revision_brief_rewrites_the_existing_text(client_for_app):
    """Revision and Editing work on the chapter as written, with the findings the
    user accepted — not a fresh draft from the outline abstract."""
    api_client, mock_llm = client_for_app
    captured = {}

    async def _capture(**kwargs):
        captured.update(kwargs)
        return ("revised prose", {}, "stop")

    mock_llm.generate_with_meta = _capture
    r = api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [
            {"id": "s1", "title": "Intro", "abstract": "ABSTRACT-MARKER"},
            {"id": "s2", "title": "Body", "abstract": "b"},
        ],
        "section_index": 0,
        "revision": {
            "stage_label": "Revision",
            "instruction": "BRIEF-MARKER apply the accepted findings",
            "notes": "- FINDING-MARKER: the term 'control' is used two ways",
            "current_content": "CURRENT-TEXT-MARKER The chapter as drafted.",
        },
    })
    assert r.status_code == 200
    assert r.json()["content"] == "revised prose"
    prompt = captured["prompt"]
    for marker in ("BRIEF-MARKER", "FINDING-MARKER", "CURRENT-TEXT-MARKER"):
        assert marker in prompt
    assert "apply only the ones that concern this section" in prompt
    assert "Return the whole section as it should now read" in prompt
    # A rewrite is not a first draft: the drafting instruction is not sent.
    assert "WRITE SECTION 1" not in prompt


def test_section_prose_without_a_revision_is_still_a_first_draft(client_for_app):
    api_client, mock_llm = client_for_app
    captured = {}

    async def _capture(**kwargs):
        captured.update(kwargs)
        return ("prose", {}, "stop")

    mock_llm.generate_with_meta = _capture
    api_client.post("/api/generate-section-prose", json={
        "inputs": _basic_inputs_dict(),
        "outline": [{"id": "s1", "title": "Intro", "abstract": "a"}],
        "section_index": 0,
    })
    assert "WRITE SECTION 1: Intro" in captured["prompt"]


def test_section_prose_carries_the_stage_hint_into_the_prompt(client_for_app):
    api_client, mock_client = client_for_app
    mock_client.generate_with_meta = AsyncMock(return_value=("Prose.", {}, "stop"))
    api_client.post("/api/generate-section-prose", json={
        "inputs": {"objective": "A book about lions", "audience": "General", "mode": "architect"},
        "outline": [{"id": "s1", "title": "Habitat", "abstract": "Where lions live."}],
        "section_index": 0,
        "stage_hint": "Stay inside that abstract.",
    })
    call = mock_client.generate_with_meta.call_args
    system = call.kwargs.get("system") or call.args[1]
    assert "THIS STAGE:\nStay inside that abstract." in system
    assert "You do not write final prose" not in system
