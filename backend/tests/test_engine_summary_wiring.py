"""Iteration-creating endpoints must wire up summary generation.

These were previously source-string assertions (`"generate_summary" in src`).
That broke when engine.py was collapsed onto the shared pipeline, and worse,
two of the three kept passing only because the word "summary" survived in a
docstring — they would have passed with the wiring removed. These assert the
behaviour instead.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.schemas import DimensionScore, EvaluationResult


def _evaluation() -> EvaluationResult:
    return EvaluationResult(
        alignment=DimensionScore(score="High", explanation="ok"),
        clarity=DimensionScore(score="High", explanation="ok"),
        drift=DimensionScore(score="Low", explanation="ok"),
    )


@pytest.fixture
def client_with_mocks(basic_inputs, basic_iteration):
    llm = AsyncMock()
    llm.generate_with_meta = AsyncMock(return_value=("NEW OUTPUT", {}, "stop"))
    app.dependency_overrides[get_client] = lambda: llm
    with patch("routers._pipeline.evaluate_output", AsyncMock(return_value=_evaluation())) as ev, \
         patch("routers._pipeline.generate_suggestions", AsyncMock(return_value=["s1"])) as sg, \
         patch("routers._pipeline.generate_summary", AsyncMock(return_value="Tightened the argument.")) as sm:
        yield TestClient(app), ev, sg, sm
    app.dependency_overrides.pop(get_client, None)


def _payload(inputs, history):
    return {
        "inputs": inputs.model_dump(),
        "prompt_text": "Do the thing.",
        "system_text": "You are a helper.",
        "iteration_number": len(history) + 1,
        "iteration_history": [h.model_dump() for h in history],
        "source": "initial",
    }


def test_run_iteration_generates_summary_when_a_previous_version_exists(
    client_with_mocks, basic_inputs, basic_iteration
):
    client, _ev, _sg, summary = client_with_mocks
    res = client.post("/api/run-iteration", json=_payload(basic_inputs, [basic_iteration]))
    assert res.status_code == 200, res.text
    summary.assert_awaited_once()
    assert res.json()["iteration"]["summary"] == "Tightened the argument."


def test_run_iteration_skips_summary_on_the_first_iteration(client_with_mocks, basic_inputs):
    client, _ev, _sg, summary = client_with_mocks
    res = client.post("/api/run-iteration", json=_payload(basic_inputs, []))
    assert res.status_code == 200, res.text
    # Nothing to summarise a change against — and the call costs money.
    summary.assert_not_awaited()
    assert res.json()["iteration"]["summary"] is None


def test_run_iteration_evaluates_and_suggests(client_with_mocks, basic_inputs, basic_iteration):
    client, ev, sg, _sm = client_with_mocks
    res = client.post("/api/run-iteration", json=_payload(basic_inputs, [basic_iteration]))
    assert res.status_code == 200, res.text
    ev.assert_awaited_once()
    sg.assert_awaited_once()
    assert res.json()["suggestions"] == ["s1"]


def _flow_payload(inputs, history, trigger):
    return {
        "inputs": inputs.model_dump(),
        "current_output": "Previous answer.",
        "trigger": trigger,
        "evaluation": None,
        "iteration_number": len(history) + 1,
        "iteration_history": [h.model_dump() for h in history],
    }


def test_flow_trigger_generates_summary_for_a_refine(
    client_with_mocks, basic_inputs, basic_iteration
):
    client, ev, _sg, summary = client_with_mocks
    res = client.post(
        "/api/flow-trigger", json=_flow_payload(basic_inputs, [basic_iteration], "refine_shorter")
    )
    assert res.status_code == 200, res.text
    summary.assert_awaited_once()
    ev.assert_awaited_once()


@pytest.mark.parametrize("trigger", ["challenge", "self_audit", "reframe"])
def test_diagnostic_triggers_are_returned_unevaluated(
    client_with_mocks, basic_inputs, basic_iteration, trigger
):
    """Diagnostics critique the previous answer; scoring them is meaningless."""
    client, ev, sg, summary = client_with_mocks
    res = client.post(
        "/api/flow-trigger", json=_flow_payload(basic_inputs, [basic_iteration], trigger)
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["iteration"]["evaluation"] is None
    assert body["suggestions"] == []
    ev.assert_not_awaited()
    sg.assert_not_awaited()
    summary.assert_not_awaited()


def test_iteration_carries_the_fr10_provenance_fields(
    client_with_mocks, basic_inputs, basic_iteration
):
    """FR-10 requires timestamp, model, and the instruction that produced a version."""
    client, _ev, _sg, _sm = client_with_mocks
    payload = _payload(basic_inputs, [basic_iteration])
    payload["model"] = "openai/gpt-5.4"
    res = client.post("/api/run-iteration", json=payload)
    assert res.status_code == 200, res.text
    it = res.json()["iteration"]
    assert it["created_at"], "created_at must be set"
    assert it["created_at"].startswith("20"), f"expected ISO-8601, got {it['created_at']!r}"
    assert it["model_used"] == "openai/gpt-5.4"


def test_flow_trigger_records_the_instruction_that_produced_the_version(
    client_with_mocks, basic_inputs, basic_iteration
):
    client, _ev, _sg, _sm = client_with_mocks
    res = client.post(
        "/api/flow-trigger", json=_flow_payload(basic_inputs, [basic_iteration], "refine_shorter")
    )
    assert res.status_code == 200, res.text
    it = res.json()["iteration"]
    assert it["instruction"], "a flow trigger should record its instruction for version history"
    assert it["created_at"]


def test_diagnostic_iteration_also_carries_provenance(
    client_with_mocks, basic_inputs, basic_iteration
):
    """The diagnostic early-return path bypasses the pipeline — it must not skip provenance."""
    client, _ev, _sg, _sm = client_with_mocks
    res = client.post(
        "/api/flow-trigger", json=_flow_payload(basic_inputs, [basic_iteration], "challenge")
    )
    assert res.status_code == 200, res.text
    it = res.json()["iteration"]
    assert it["created_at"]
    assert it["instruction"]
