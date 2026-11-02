"""A finding that carries out the user's own decision is not a new decision (1 Nov).

Sean's recruitment plan: after his "Change it" correction (budget $250, no tester
payments, honest feedback of any tone, stuck testers asked for feedback), a recheck
wrote Check finding i11 — "Do not carry i2's reserve … keep tester payments at $0" —
marked major. Severity alone made it the user's, so Go held the project open on
it and he was asked to approve carrying out his own instruction.

Triage rows now quote the accepted fact they carry out (`implements`) or alter
(`changes`); the client matches the quote against the facts in code.
"""

from __future__ import annotations

from promptmaster.schemas import PMInput, AcceptedFact, StageDescriptor, StageDigest, StageItemField, StageItemSchema, StageItemStatus
from promptmaster.stage import CHANGES_KEY, IMPLEMENTS_KEY, _parse_items, build_stage_prompt


def _check_schema() -> StageItemSchema:
    return StageItemSchema(
        item_label="finding",
        fields=[
            StageItemField(key="finding", label="Finding"),
            StageItemField(key="suggested_change", label="Suggested change"),
            StageItemField(key="severity", label="Severity"),
        ],
        statuses=[
            StageItemStatus(value="accepted", label="Accept"),
            StageItemStatus(value="deferred", label="Defer", requires_reason=True),
            StageItemStatus(value="rejected", label="Reject", requires_reason=True),
        ],
        min_items=1,
        max_items=12,
    )


def _inputs() -> PMInput:
    return PMInput(
        objective="A two-week plan to recruit five early testers for the AI workspace.",
        mode="architect",
        facts=[
            AcceptedFact(statement="There are no promised tester payments.", kind="fact"),
            AcceptedFact(statement="The total two-week marketing budget is $250, not $400.", kind="requirement"),
        ],
    )


def test_a_triage_table_asks_which_accepted_fact_a_finding_carries_out_or_alters():
    stage = StageDescriptor(id="check", label="Check the plan", renderer="review", entry_prompt_hint="Check it.", artifact_kind="critique_report")
    system, user = build_stage_prompt(_inputs(), stage, StageDigest(entries=[]), _check_schema())
    prompt = system + user
    assert f"- {IMPLEMENTS_KEY}:" in prompt and f"- {CHANGES_KEY}:" in prompt
    assert "is not a new decision for the user" in prompt
    assert "whatever the finding's severity" in prompt
    # The facts it quotes from are in the same prompt.
    assert "There are no promised tester payments." in prompt


def test_a_table_without_triage_is_not_asked():
    schema = StageItemSchema(item_label="segment", fields=[StageItemField(key="who", label="Who")])
    stage = StageDescriptor(id="aud", label="Audience", renderer="list", entry_prompt_hint="List them.")
    system, user = build_stage_prompt(_inputs(), stage, StageDigest(entries=[]), schema)
    assert f"- {IMPLEMENTS_KEY}:" not in system + user


def test_the_quotes_survive_parsing_and_empty_ones_are_dropped():
    items = _parse_items(
        {
            "items": [
                {
                    "id": "i11",
                    "finding": "i2 rests on two premises that no longer hold.",
                    "suggested_change": "Do not carry i2's reserve into the final plan. Keep tester payments at $0.",
                    "severity": "major",
                    IMPLEMENTS_KEY: "There are no promised tester payments.",
                    CHANGES_KEY: "",
                    "invented_column": "dropped",
                }
            ]
        },
        _check_schema(),
    )
    row = items[0].model_dump()
    assert row[IMPLEMENTS_KEY] == "There are no promised tester payments."
    assert CHANGES_KEY not in row
    assert "invented_column" not in row


def test_the_planner_on_a_later_stage_is_given_the_open_row_itself():
    """Go on Final plan said "I can't see the Check table from this stage" (14:32:43)."""
    from promptmaster.agent import AgentOpenFinding, AgentState, build_next_action_prompt

    state = AgentState(
        stage_id="final_plan",
        stage_label="Final two-week recruitment plan",
        open_findings_elsewhere=[
            AgentOpenFinding(
                stage_id="check", stage_label="Check", id="i11", severity="major",
                text="i2 rests on two premises that no longer hold.",
                suggested_change="Keep tester payments at $0.",
            )
        ],
    )
    _, user = build_next_action_prompt(_inputs(), state, ["request_user_decision"], "guided")
    assert "UNDECIDED FINDINGS ON OTHER STAGES" in user
    assert "- Check i11 (major): i2 rests on two premises that no longer hold. — suggested change: Keep tester payments at $0." in user
    assert "never say you cannot see another stage's table" in user


def test_no_block_when_nothing_is_open_elsewhere():
    from promptmaster.agent import AgentState, build_next_action_prompt

    _, user = build_next_action_prompt(_inputs(), AgentState(stage_id="final_plan"), ["request_user_decision"], "guided")
    assert "UNDECIDED FINDINGS ON OTHER STAGES" not in user
