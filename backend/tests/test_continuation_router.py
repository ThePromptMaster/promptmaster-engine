"""Smoke tests for the continuation router (request shapes + wiring)."""

import inspect

from routers import continuation as cont


def test_continue_document_request_has_required_fields():
    fields = cont.ContinueDocumentRequest.model_fields
    for required in ("inputs", "incomplete_iteration", "iteration_number", "iteration_history", "model"):
        assert required in fields, f"missing field: {required}"


def test_router_registers_endpoint():
    paths = [r.path for r in cont.router.routes]
    assert "/api/continue-document" in paths


def test_endpoint_uses_snapshot_and_continuation_builders():
    src = inspect.getsource(cont.api_continue_document)
    assert "generate_continuity_snapshot" in src
    assert "build_continuation_prompt" in src


def test_endpoint_uses_pipeline_helper():
    src = inspect.getsource(cont.api_continue_document)
    assert "build_iteration_with_full_pipeline" in src


def test_endpoint_attaches_snapshot_to_iteration():
    """The new iteration must carry the continuity_snapshot attribute set."""
    src = inspect.getsource(cont.api_continue_document)
    assert "continuity_snapshot" in src


def test_endpoint_uses_continuation_trigger_source():
    src = inspect.getsource(cont.api_continue_document)
    assert "continuation" in src  # trigger_source string


def test_response_says_whether_the_text_is_still_cut_off():
    """31 Oct (Sean): "Continue writing" vanished while the book was still cut off,
    because the browser saved every continuation as finished."""
    assert "finish_reason" in cont.IterationFromConversationResponse.model_fields
    src = inspect.getsource(cont.api_continue_document)
    assert "finish_reason=finish_reason" in src
