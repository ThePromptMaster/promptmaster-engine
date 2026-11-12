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


def test_a_plain_count_is_told_as_counted_and_a_check_never_asks_the_text_to_state_one():
    # 12 Nov (an acquisition memo): with no count to go on, a check estimated the
    # draft "by hand reading only" and asked the memo to "state the word count,
    # labelled as an estimate".
    from promptmaster.measured import MeasuredLine, counted_words, is_hand_count, measured_block
    block = measured_block([MeasuredLine(label="Draft memo — length", value="588 words", met=None, info=True)], "THE WRITTEN WORK THIS CHECK READS")
    assert "- Draft memo — length: 588 words (counted in code)" in block
    assert "length: NOT VERIFIED" not in block
    assert "never ask the text to state its own word count" in block
    assert counted_words([MeasuredLine(label="Draft memo — length", value="588 words", met=None, info=True)])
    assert not counted_words([MeasuredLine(label="Memo: under 600 words", value="", met=None)])
    assert is_hand_count("Estimate, by hand reading only and not counted by a tool: the body runs to roughly 560–600 words.")
    assert is_hand_count("The memo states no word count.")
    assert not is_hand_count("Trim the memo, aiming for under 600 words.")
    assert not is_hand_count("The table omits the threshold.")


def test_a_check_table_drops_a_row_that_only_estimates_a_counted_length():
    import asyncio
    from unittest.mock import AsyncMock

    from promptmaster.measured import MeasuredLine
    from promptmaster.schemas import PMInput, StageDescriptor, StageDigest, StageItemField, StageItemSchema
    from promptmaster.stage import generate_stage_artifact

    client = AsyncMock()
    client.generate_json.return_value = ({"items": [
        {"id": "i5", "finding": "The memo states no word count. Estimate, by hand reading only: roughly 560–600 words.", "suggested_change": "State the word count, labelled as an estimate.", "severity": "moderate"},
        {"id": "i7", "finding": "The calculation block uses LaTeX.", "suggested_change": "Replace it with plain lines.", "severity": "minor"},
    ]}, {})
    schema = StageItemSchema(item_label="finding", fields=[StageItemField(key="finding", label="Finding"), StageItemField(key="suggested_change", label="Suggested change"), StageItemField(key="severity", label="Severity")], min_items=0, max_items=12)
    kwargs = dict(
        client=client, model=None, inputs=PMInput(objective="Screening memo under 600 words.", mode="analyst"),
        stage=StageDescriptor(id="check", label="Check the memo", renderer="review"), digest=StageDigest(objective="Screening memo under 600 words."), item_schema=schema,
    )
    counted = asyncio.run(generate_stage_artifact(**kwargs, measured=[MeasuredLine(label="Draft memo — length", value="588 words", met=None, info=True)]))
    assert [i.id for i in counted.items] == ["i7"]
    uncounted = asyncio.run(generate_stage_artifact(**kwargs, measured=[]))
    assert [i.id for i in uncounted.items] == ["i5", "i7"]
