"""Why a task the work moved past was closed (L-315, 27 Nov; Sean, payroll cutover)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.mock_llm import _json_reply
from promptmaster.task_outcomes import (
    TASK_OUTCOMES_INSTRUCTION, TASK_OUTCOMES_MODEL, FactLine, TaskLine, TaskOutcomesRequest,
    build_task_outcomes_prompt, parse_task_outcomes,
)

OPS = "South S4 ran successfully on the new system at 3:10 p.m. (OPS-02); West W4 ran successfully on the new system at 3:30 p.m., and North has not run (OPS-03)."
PACK = "## Next steps\n\n- Run N8 on the new system once the bank test is recorded.\n- Record North as not run until a completion report for North N8 arrives."


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _req(**over) -> TaskOutcomesRequest:
    return TaskOutcomesRequest(**{
        "objective": "Keep the payroll cutover plan current.",
        "tasks": [
            TaskLine(id="t1", text="Run S4 on the old system.", stage="Cutover operating pack", current=PACK),
            TaskLine(id="t2", text="Run W3 on the old system.", stage="Cutover operating pack", current=PACK),
            TaskLine(id="t3", text="Run N8 on the new system.", stage="Cutover operating pack", current=PACK),
        ],
        "facts": [FactLine(id="f1", text=OPS), FactLine(id="f2", text="West fixed its two differences in replacement file W4 (REC-03).")],
        **over,
    })


def test_prompt_gives_each_task_beside_its_documents_current_text_and_the_facts():
    system, user = build_task_outcomes_prompt(_req())
    assert system == TASK_OUTCOMES_INSTRUCTION
    assert "[t1] from Cutover operating pack\nTASK: Run S4 on the old system." in user
    assert "CURRENT TEXT OF THAT DOCUMENT:\n## Next steps" in user
    assert "[f1] South S4 ran successfully" in user
    assert "If you are unsure, say gone" in system


def test_a_label_is_kept_only_with_words_found_where_it_says():
    out = parse_task_outcomes({"outcomes": [
        {"id": "t1", "outcome": "done", "quote": "South S4 ran successfully on the new system at 3:10 p.m. (OPS-02)"},
        {"id": "t2", "outcome": "replaced", "quote": "West fixed its two differences in replacement file W4"},
        {"id": "t3", "outcome": "reworded", "now": "Run N8 on the new system once the bank test is recorded."},
    ]}, _req())
    assert [(o.id, o.outcome) for o in out.outcomes] == [("t1", "done"), ("t2", "replaced"), ("t3", "reworded")]
    assert out.outcomes[2].now == "Run N8 on the new system once the bank test is recorded."


def test_an_invented_quote_or_a_rewording_not_in_the_text_is_gone():
    out = parse_task_outcomes({"outcomes": [
        {"id": "t1", "outcome": "done", "quote": "South's run on the old system was confirmed by the bank."},
        {"id": "t2", "outcome": "replaced", "quote": ""},
        {"id": "t3", "outcome": "reworded", "now": "Run N8 on both systems."},
        {"id": "t9", "outcome": "done", "quote": OPS},
        {"id": "t1", "outcome": "done", "quote": OPS},  # a second label for t1 is ignored
        "nonsense", None,
    ]}, _req())
    assert [(o.id, o.outcome) for o in out.outcomes] == [("t1", "gone"), ("t2", "gone"), ("t3", "gone")]
    assert parse_task_outcomes(None, _req()).outcomes == []


def test_the_route_makes_one_small_call_and_a_failure_labels_nothing(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"outcomes": [{"id": "t1", "outcome": "done", "quote": "South S4 ran successfully on the new system"}]}, {})
    body = {"objective": "x", "tasks": [{"id": "t1", "text": "Run S4 on the old system.", "stage": "Pack", "current": PACK}], "facts": [{"id": "f1", "text": OPS}]}
    res = http.post("/api/agent/task-outcomes", json=body)
    assert res.status_code == 200
    assert res.json()["outcomes"] == [{"id": "t1", "outcome": "done", "quote": "South S4 ran successfully on the new system", "now": ""}]
    assert mock.generate_json.await_args.kwargs["model"] == TASK_OUTCOMES_MODEL
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/task-outcomes", json=body)
    assert res.status_code == 200 and res.json() == {"outcomes": []}


def test_no_tasks_means_no_call(client_for_app):
    http, mock = client_for_app
    res = http.post("/api/agent/task-outcomes", json={"objective": "x", "tasks": [], "facts": []})
    assert res.json() == {"outcomes": []} and mock.generate_json.await_count == 0


def test_the_mock_marks_a_task_done_when_a_fact_says_its_file_ran():
    req = _req()
    system, user = build_task_outcomes_prompt(req)
    out = parse_task_outcomes(_json_reply(system, user), req)
    assert [(o.id, o.outcome) for o in out.outcomes] == [("t1", "done"), ("t2", "gone"), ("t3", "gone")]
