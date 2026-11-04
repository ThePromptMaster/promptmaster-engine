"""What code counted reaches every check of the text (4 Nov).

Sean, support-software memo: a check row said "Estimated length is about
470–490 words … No word count was run", and "the manual check estimated
roughly 480 words and declared the memo under 500 without counting". A check
that has the code's count reports it; one that has none says not verified.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.criterion_check import FINDINGS_TABLE_RULE, build_check_prompt
from promptmaster.measured import MeasuredLine, measured_block
from promptmaster.schemas import StageDescriptor, StageDigest
from promptmaster.stage import generate_stage_artifact
from promptmaster.stage_evaluation import evaluate_stage_artifact

LINES = [
    MeasuredLine(label="Memo: at most 500 words (headings included)", value="487 words", met=True),
    MeasuredLine(label="Executive update: at most 100 words", value="not verified: no part of the saved text is headed for it", met=None),
]


def test_the_block_says_each_count_and_what_was_not_counted():
    block = measured_block(LINES)
    assert block.startswith("MEASURED IN CODE ON THIS TEXT")
    assert "- Memo: at most 500 words (headings included): 487 words — met" in block
    assert "- Executive update: at most 100 words: NOT VERIFIED — not verified: no part" in block
    assert "never estimate one, never count by hand, never contradict them" in block
    assert measured_block([]) == ""


async def test_the_stage_check_is_given_the_counts(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({}, {}))
    stage = StageDescriptor(id="final", label="Final decision memo", renderer="prose", entry_prompt_hint="Write it.")
    await evaluate_stage_artifact(client=client, inputs=basic_inputs, stage=stage, content="# Memo\nText.", digest=StageDigest(), measured=LINES)
    prompt = client.generate_json.await_args.kwargs["prompt"]
    assert "MEASURED IN CODE ON THIS TEXT" in prompt and "487 words — met" in prompt
    client.generate_json.reset_mock()
    await evaluate_stage_artifact(client=client, inputs=basic_inputs, stage=stage, content="# Memo\nText.", digest=StageDigest())
    assert "MEASURED IN CODE" not in client.generate_json.await_args.kwargs["prompt"]


async def test_a_check_table_is_given_the_counts_of_the_work_it_checks(basic_inputs):
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=({"items": []}, {}))
    stage = StageDescriptor(id="check", label="Check memo against brief", renderer="review", entry_prompt_hint="Check it.")
    await generate_stage_artifact(client=client, model=None, inputs=basic_inputs, stage=stage, digest=StageDigest(), measured=[
        MeasuredLine(label="Draft decision memo — Memo: at most 500 words (headings included)", value="496 words", met=True),
    ])
    prompt = client.generate_json.await_args.kwargs["prompt"]
    assert "MEASURED IN CODE ON THE WRITTEN WORK THIS CHECK READS" in prompt
    assert "Draft decision memo — Memo: at most 500 words (headings included): 496 words — met" in prompt


def test_a_findings_table_approval_is_judged_on_decisions_not_on_changes_made_later(basic_inputs):
    _, plain = build_check_prompt(basic_inputs, "Draft", "I approve this draft", "Text.")
    assert FINDINGS_TABLE_RULE not in plain
    _, table = build_check_prompt(
        basic_inputs, "Check memo against brief", "I accept that the memo meets the brief once these findings are applied",
        '{"kind":"stage_items","items":[]}', measured=LINES, findings_table=True,
    )
    assert FINDINGS_TABLE_RULE in table
    assert "never require the table to show the change already made" in table
    assert "487 words — met" in table


def test_the_routes_carry_the_counts():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"met": True, "reason": "ok"}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/agent/check-criterion", json={
            "inputs": {"objective": "A memo.", "mode": "architect"},
            "stage_label": "Check", "criterion": "I accept the check", "content": "rows",
            "measured": [l.model_dump() for l in LINES], "findings_table": True,
        })
        assert r.status_code == 200
        prompt = stub.generate_json.await_args.kwargs["prompt"]
        assert FINDINGS_TABLE_RULE in prompt and "487 words — met" in prompt
    finally:
        app.dependency_overrides.pop(get_client, None)
