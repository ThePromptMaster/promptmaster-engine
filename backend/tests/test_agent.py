"""Go mode's planner and actors (PM-12, PM-17, PM-19).

Asserted on prompt content and on the contract each endpoint promises, never on
model output: the planner cannot invent an action, code-writing cannot claim a
result, and interpretation only sees output that really came back.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.agent import (
    AgentState,
    AgentStepSummary,
    build_interpret_prompt,
    build_next_action_prompt,
    build_reason_prompt,
    build_write_code_prompt,
    clean_code,
    parse_next_action,
)
from promptmaster.agent_actions import ACTION_KEYS, AGENT_ACTIONS, REASONING_ACTIONS
from promptmaster.llm_client import OpenRouterError
from promptmaster.mock_llm import ScriptedClient
from promptmaster.schemas import PMInput
from tests.test_self_model import _assert_self_model

INPUTS = PMInput(objective="Show the pendulum period is independent of mass", audience="Physicists", mode="architect")
STATE = AgentState(
    stage_id="experiment",
    stage_label="Experiment",
    stage_instruction="Design and run the experiment.",
    artifact_excerpt="Hypothesis: T = 2π√(L/g).",
    criteria_met=["Hypothesis stated"],
    criteria_unmet=["Every item has a status"],
    next_stage_label="Literature",
    recent_steps=[AgentStepSummary(action_key="derive", status="done", execution_label="discussed", output="T = 2π√(L/g)")],
)
RESEARCH = ["derive", "prove", "run_computation", "check_literature", "advance_stage", "request_user_decision"]

J = {"inputs": INPUTS.model_dump(), "state": STATE.model_dump()}


# --- the registry ---------------------------------------------------------------


def test_registry_has_seans_research_moves():
    for key in ("derive", "prove", "simplify", "limiting_case", "try_contradiction", "run_computation",
                "falsify_hypothesis", "compare_alternatives", "check_literature", "update_assumptions"):
        assert key in ACTION_KEYS


def test_registry_keys_are_unique_and_reasoning_is_a_subset():
    assert len(ACTION_KEYS) == len(AGENT_ACTIONS)
    assert REASONING_ACTIONS <= ACTION_KEYS
    # Anything that runs, fetches or moves the workflow is not "reasoning".
    assert not {"run_computation", "check_literature", "advance_stage"} & REASONING_ACTIONS


# --- next action ------------------------------------------------------------------


def test_next_action_prompt_lists_only_allowed_moves_and_the_state():
    system, user = build_next_action_prompt(INPUTS, STATE, ["derive", "run_computation"], "checkpoint")
    _assert_self_model(system)
    assert "CHECKPOINT" in system
    assert "- derive: Derive." in user
    assert "- run_computation:" in user
    assert "prove:" not in user
    assert "CURRENT STAGE: Experiment" in user
    assert "Every item has a status" in user
    assert "- derive → done [discussed]" in user
    assert f"OBJECTIVE (authoritative): {INPUTS.objective}" in user


def test_parse_accepts_an_allowed_choice():
    choice = parse_next_action(
        {"action_key": "run_computation", "params": {"goal": "period vs mass"}, "rationale": "Numbers settle it."},
        RESEARCH,
    )
    assert choice.action_key == "run_computation"
    assert choice.params == {"goal": "period vs mass"}
    assert not choice.needs_user_decision


@pytest.mark.parametrize("bad", ["simplify", "delete_everything", "", None])
def test_parse_turns_anything_outside_the_list_into_a_question(bad):
    choice = parse_next_action({"action_key": bad}, RESEARCH)
    assert choice.action_key == "request_user_decision"
    assert choice.needs_user_decision
    assert choice.decision_question


def test_parse_survives_a_non_object():
    assert parse_next_action(["derive"], RESEARCH).action_key == "request_user_decision"


def test_completion_and_decision_flags_follow_the_key_not_the_model():
    done = parse_next_action({"action_key": "declare_objective_complete", "objective_complete": False},
                             RESEARCH + ["declare_objective_complete"])
    assert done.objective_complete
    ask = parse_next_action({"action_key": "request_user_decision", "needs_user_decision": False}, RESEARCH)
    assert ask.needs_user_decision


# --- performing -------------------------------------------------------------------


def test_reason_prompt_forbids_claiming_execution():
    system, user = build_reason_prompt(INPUTS, STATE, "limiting_case", {"focus": "small angles"})
    _assert_self_model(system)
    assert "PERFORM: TEST A LIMITING CASE" in system
    assert "you are not running code" in system
    assert "Focus: small angles" in user


def test_write_code_prompt_asks_for_code_only_and_no_claimed_output():
    system, user = build_write_code_prompt(INPUTS, STATE, "period for three masses", "simulation")
    _assert_self_model(system)
    assert "Return ONLY the code" in system
    assert "never any claimed output" in system
    assert "no network access" in system
    assert "simulation: period for three masses" in user


def test_interpret_prompt_embeds_the_real_output_and_forbids_new_numbers():
    system, user = build_interpret_prompt(INPUTS, STATE, "print(1)", "T = 2.006 s", "", 0)
    _assert_self_model(system)
    assert "Never state a number that is not in the output" in system
    assert "--- STDOUT ---\nT = 2.006 s" in user
    assert "--- EXIT CODE ---\n0" in user
    assert "--- STDERR ---\n(empty)" in user


def test_clean_code_strips_a_fence():
    assert clean_code("```python\nprint(1)\n```") == "print(1)"
    assert clean_code("print(1)") == "print(1)"


# --- the router ---------------------------------------------------------------------


@pytest.fixture
def client_with():
    def _install(stub):
        app.dependency_overrides[get_client] = lambda: stub
        return TestClient(app, raise_server_exceptions=False)

    yield _install
    app.dependency_overrides.pop(get_client, None)


def test_next_action_endpoint_validates_the_choice(client_with):
    stub = AsyncMock()
    stub.model = "test/model"
    stub.generate_json = AsyncMock(return_value=({"action_key": "prove", "rationale": "Show it."}, {}))
    r = client_with(stub).post("/api/agent/next-action", json={**J, "allowed_actions": RESEARCH, "policy": "autonomous"})
    assert r.status_code == 200, r.text
    assert r.json()["action_key"] == "prove"
    assert r.json()["model_used"] == "test/model"
    system = stub.generate_json.call_args.kwargs["system"]
    assert "AUTONOMOUS" in system


def test_next_action_endpoint_refuses_unknown_allowed_actions(client_with):
    stub = AsyncMock()
    r = client_with(stub).post("/api/agent/next-action", json={**J, "allowed_actions": ["hack"]})
    assert r.status_code == 422
    stub.generate_json.assert_not_called()


def test_reason_endpoint_refuses_non_reasoning_actions(client_with):
    stub = AsyncMock()
    r = client_with(stub).post("/api/agent/reason", json={**J, "action_key": "run_computation"})
    assert r.status_code == 422
    stub.generate.assert_not_called()


def test_llm_failure_maps_to_the_shared_error_shape(client_with):
    stub = AsyncMock()
    stub.generate = AsyncMock(side_effect=OpenRouterError("OpenRouter API error 402: no credits", status_code=402,
                                                          provider_code="insufficient_credits"))
    r = client_with(stub).post("/api/agent/reason", json={**J, "action_key": "derive"})
    assert r.status_code == 502  # the shared contract: provider status travels in the body
    assert r.json()["detail"]["provider_status"] == 402
    assert "untouched" in str(r.json()["detail"])


def test_every_agent_route_requires_auth():
    from auth import require_user

    saved = app.dependency_overrides.pop(require_user)
    try:
        http = TestClient(app, raise_server_exceptions=False)
        for path in ("/api/agent/next-action", "/api/agent/reason", "/api/agent/write-code", "/api/agent/interpret-result"):
            assert http.post(path, json={}).status_code == 401, path
        assert http.get("/api/agent/actions").status_code == 401
    finally:
        app.dependency_overrides[require_user] = saved


# --- the mock the E2E drives --------------------------------------------------------


@pytest.fixture
def mock_http():
    app.dependency_overrides[get_client] = lambda: ScriptedClient()
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_client, None)


def _mock_state(steps):
    return {**STATE.model_dump(), "recent_steps": [{"action_key": k, "status": "done"} for k in steps]}


def test_mock_planner_follows_a_scripted_plan_then_completes(mock_http):
    inputs = {**INPUTS.model_dump(), "objective": "Pendulum [[mock:plan=derive,run_computation,check_literature]]"}
    allowed = RESEARCH + ["declare_objective_complete"]
    seen = []
    for _ in range(4):
        r = mock_http.post("/api/agent/next-action",
                           json={"inputs": inputs, "state": _mock_state(seen), "allowed_actions": allowed})
        assert r.status_code == 200, r.text
        seen.append(r.json()["action_key"])
    assert seen == ["derive", "run_computation", "check_literature", "declare_objective_complete"]


def test_mock_planner_without_a_plan_tries_each_allowed_move_once(mock_http):
    r = mock_http.post("/api/agent/next-action",
                       json={**J, "state": _mock_state(["derive"]), "allowed_actions": RESEARCH})
    assert r.json()["action_key"] == "prove"


def test_mock_code_round_trip(mock_http):
    code = mock_http.post("/api/agent/write-code", json={**J, "goal": "2+2"}).json()["code"]
    assert code.startswith("result = 2 + 2")  # fence stripped
    text = mock_http.post("/api/agent/interpret-result", json={
        **J, "sandbox_run_id": "00000000-0000-0000-0000-000000000009", "code": code, "stdout": "2 + 2 = 4", "exit_code": 0,
    }).json()["text"]
    assert "2 + 2 = 4" in text


def test_mock_reason(mock_http):
    r = mock_http.post("/api/agent/reason", json={**J, "action_key": "prove"})
    assert "Mock Prove" in r.json()["text"]


def test_mock_code_markers_drive_the_sandbox_branches(mock_http):
    inputs = {**INPUTS.model_dump(), "objective": "Pendulum [[mock:sandbox=unavailable]]"}
    code = mock_http.post("/api/agent/write-code", json={"inputs": inputs, "state": STATE.model_dump()}).json()["code"]
    assert "# mock:unavailable" in code
