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


# --- B0: the planner is told what exists on outline, long-form and review stages


def test_state_facts_reach_the_prompt():
    from promptmaster.agent import AgentFindings, AgentManuscript, AgentOutline

    state = STATE.model_copy(update={
        "stage_label": "Drafting",
        "artifact_excerpt": "",
        "outline": AgentOutline(sections=["1. Habitat", "2. Diet"], named_count=2, approved=True),
        "manuscript": AgentManuscript(total=2, complete=1, pending_jobs=1, written=["1. Habitat"], unwritten=["2. Diet"]),
        "findings": AgentFindings(total=3, triaged=1, sample=["Chapter 2 repeats chapter 1"]),
        "tools": {"literature": False},
    })
    _, user = build_next_action_prompt(INPUTS, state, RESEARCH, "guided")
    assert "OUTLINE: 2 named section(s), approved for drafting — approval is done; never ask the user to approve it again: 1. Habitat; 2. Diet" in user
    assert "MANUSCRIPT: 1 of 2 section(s) written, 1 being written now; written: 1. Habitat; still unwritten: 2. Diet" in user
    assert "FINDINGS: 3 in the table, 1 decided by the user, 2 still undecided: Chapter 2 repeats chapter 1" in user
    assert "TOOLS: literature=no" in user


def test_without_facts_the_prompt_is_as_before():
    _, user = build_next_action_prompt(INPUTS, STATE, RESEARCH, "guided")
    assert "OUTLINE:" not in user and "MANUSCRIPT:" not in user and "FINDINGS:" not in user


def test_the_planner_is_told_not_to_block_for_work_the_stage_controls_do():
    system, _ = build_next_action_prompt(INPUTS, STATE, RESEARCH, "guided")
    assert "Never mark_blocked for it" in system
    assert "press Generate the outline" in system


# --- B3: deciding the routine findings ----------------------------------------


def test_triage_prompt_lists_the_rows_and_the_statuses_offered():
    from promptmaster.agent import TriageStatus, build_triage_prompt

    statuses = [TriageStatus(value="accepted", label="Accept"), TriageStatus(value="rejected", label="Reject", requires_reason=True)]
    system, user = build_triage_prompt(INPUTS, STATE, [{"id": "i2", "finding": "Ch 3 repeats Ch 1", "severity": "minor"}], statuses)
    assert "DECIDE THE ROUTINE FINDINGS" in system
    assert "- id=i2: finding: Ch 3 repeats Ch 1; severity: minor" in user
    assert "- accepted: Accept" in user
    assert "- rejected: Reject (reason required)" in user
    _assert_self_model(system)


def test_parse_triage_keeps_only_decisions_the_table_allows():
    from promptmaster.agent import TriageStatus, parse_triage

    statuses = [TriageStatus(value="accepted"), TriageStatus(value="rejected", requires_reason=True)]
    decisions = parse_triage({"decisions": [
        {"id": "a", "status": "accepted"},
        {"id": "b", "status": "rejected"},                      # reason required, none given
        {"id": "c", "status": "verified"},                      # not offered
        {"id": "zz", "status": "accepted"},                     # not asked about
        {"id": "a", "status": "rejected", "reason": "twice"},   # already decided above
        {"id": "d", "status": "rejected", "reason": "The text does not say that."},
    ]}, {"a", "b", "c", "d"}, statuses)
    assert [(d.id, d.status, d.reason) for d in decisions] == [("a", "accepted", ""), ("d", "rejected", "The text does not say that.")]
    assert parse_triage("nonsense", {"a"}, statuses) == []
    assert parse_triage({"decisions": "nonsense"}, {"a"}, statuses) == []


def test_triage_endpoint_returns_the_decisions(client_with):
    stub = AsyncMock()
    stub.model = "test/model"
    stub.generate_json = AsyncMock(return_value=({"decisions": [{"id": "i1", "status": "accepted", "reason": ""}]}, {}))
    r = client_with(stub).post("/api/agent/triage", json={
        **J, "items": [{"id": "i1", "finding": "Minor thing", "severity": "minor"}],
        "statuses": [{"value": "accepted", "label": "Accept", "requires_reason": False}],
    })
    assert r.status_code == 200, r.text
    assert r.json() == {"decisions": [{"id": "i1", "status": "accepted", "reason": ""}], "model_used": "test/model"}


def test_triage_route_requires_auth():
    from auth import require_user

    saved = app.dependency_overrides.pop(require_user)
    try:
        http = TestClient(app, raise_server_exceptions=False)
        assert http.post("/api/agent/triage", json={}).status_code == 401
    finally:
        app.dependency_overrides[require_user] = saved


def test_mock_triage_accepts_every_routine_row(mock_http):
    r = mock_http.post("/api/agent/triage", json={
        **J, "items": [{"id": "i2", "finding": "x", "severity": "minor"}, {"id": "i3", "finding": "y", "severity": "minor"}],
        "statuses": [{"value": "accepted", "label": "Accept", "requires_reason": False}],
    })
    assert r.status_code == 200, r.text
    assert [d["id"] for d in r.json()["decisions"]] == ["i2", "i3"]


def test_planner_is_told_to_speak_to_the_user_in_plain_language():
    """1 Oct, items 4 and 23: "the action set did not include an action that
    could create the outline" was the model repeating the prompt's own words."""
    system, user = build_next_action_prompt(INPUTS, STATE, RESEARCH, "guided")
    assert "is shown to the user, who is not a developer" in system
    assert 'Never use the words "artifact", "action set"' in system
    assert "MOVES AVAILABLE NOW:" in user
    assert "WHAT THIS STAGE HOLDS NOW" in user
    for leaked in ("ALLOWED ACTIONS", "STAGE ARTIFACT", "allowed action"):
        assert leaked not in user


def test_a_choice_outside_the_menu_asks_without_naming_the_key():
    choice = parse_next_action({"action_key": "write_the_outline"}, RESEARCH)
    assert choice.action_key == "request_user_decision"
    assert "write_the_outline" not in (choice.decision_question or "")
    assert "not available here" not in (choice.decision_question or "")


# --- 1 Oct, items 16 and 17: the project's data reaches the prompts, and only its shape ---

def _state_with_data():
    from promptmaster.schemas import DataFileBrief

    return STATE.model_copy(update={"data_files": [
        DataFileBrief(name="accounts.csv", kind="table", columns=["account_id", "plan", "churned"],
                      sample=[["A1", "Mid-Market", "1"]], rows=1204),
    ]})


def test_the_planner_is_told_what_data_exists_and_when_there_is_none():
    _, with_data = build_next_action_prompt(INPUTS, _state_with_data(), RESEARCH, "guided")
    assert "DATA THE PROJECT HOLDS (readable by code you run" in with_data
    assert "- /data/accounts.csv — 1204 rows; columns: account_id, plan, churned" in with_data
    assert "e.g. A1 | Mid-Market | 1" in with_data
    _, without = build_next_action_prompt(INPUTS, STATE, RESEARCH, "guided")
    assert "DATA THE PROJECT HOLDS: none" in without
    assert "say what data is missing" in without


def test_the_code_writer_is_told_to_read_only_listed_files_and_never_invent_data():
    from promptmaster.agent import build_write_code_prompt

    system, user = build_write_code_prompt(INPUTS, _state_with_data(), "Churn rate by plan", "computation")
    assert "Use only files that are listed, by the exact path shown" in system
    assert "never invent a file, a column or a value" in system
    # pandas is in the sandbox image now, and results are printed so they can be recorded.
    assert "numpy, scipy, sympy, matplotlib and pandas" in system
    assert "Read them with pandas, or the csv or json modules" in system
    assert "on its own line as `label: value`" in system
    # Missing data is said in one recognisable line and a non-zero exit, so
    # the run is recorded as not made — never as executed (2 Oct, item 1).
    assert "`MISSING_DATA: <exactly what is missing, as one plain sentence>`" in system
    assert "raise SystemExit(2)" in system
    assert "do not compute on placeholders" in system
    assert "/data/accounts.csv" in user


def test_a_computation_can_name_the_row_of_the_table_it_carries_out():
    from promptmaster.agent_actions import ACTIONS_BY_KEY

    when = ACTIONS_BY_KEY["run_computation"].when
    assert "row (the number of the row in this stage's table that the computation carries out" in when
    assert "otherwise leave it out" in when
    _, user = build_next_action_prompt(INPUTS, _state_with_data(), ["run_computation"], "guided")
    assert "row (the number of the row" in user


def test_the_planner_is_told_the_order_is_a_default_and_can_suggest_a_skip():
    """1 Oct, item 11: "the workflow template should guide the reasoning engine, but not mechanically imprison it"."""
    system, user = build_next_action_prompt(INPUTS, STATE, [*RESEARCH, "propose_skip"], "autonomous")
    assert "The workflow's order is a sensible default, not a rule" in system
    assert "do not work through a stage only because it comes next" in system
    assert "- propose_skip: Suggest skipping this stage." in user
    assert "The user decides; nothing is skipped unless they agree." in user


def test_the_planner_is_given_what_the_user_already_decided():
    """1 Oct, item 20: keep going across sessions without losing decisions and rejected routes."""
    state = STATE.model_copy(update={"memory": [
        "Skipped Literature context: Internal diagnosis; external reading later",
        'Asked "Which segment first?", the user answered: Mid-Market.',
    ]})
    _, user = build_next_action_prompt(INPUTS, state, RESEARCH, "autonomous")
    assert "ALREADY DECIDED ON THIS PROJECT, by the user, earlier (possibly in an earlier session)" in user
    assert "Do not ask again about something settled here" in user
    assert "- Skipped Literature context: Internal diagnosis; external reading later" in user
    assert '- Asked "Which segment first?", the user answered: Mid-Market.' in user
    _, without = build_next_action_prompt(INPUTS, STATE, RESEARCH, "autonomous")
    assert "ALREADY DECIDED ON THIS PROJECT" not in without
