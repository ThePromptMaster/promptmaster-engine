"""The finished deliverable is checked for what was accepted and for its own consistency (1 Nov).

Sean's tattoo memo kept "a refundable or phased deposit" as a cure for the
upfront cash shortfall and "adopt B on a continuing basis" at $8,000 a month,
which the memo itself says only covers the operating costs. The recruitment
plan let a paused ad clear the budget gate while its restart rule let it run
again unchecked.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.deliverable_check import AcceptedFinding, build_prompt, parse
from promptmaster.schemas import AcceptedFact, PMInput

MEMO = (
    "Recommendation: hold steady (C) and pilot expanded hours (B).\n"
    "A refundable or phased deposit could remove the upfront cash shortfall.\n"
    "At $8,000 a month the added revenue covers the artist compensation and operating costs, but does not recover the $8,000 setup.\n"
    "Decision rule: if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.\n"
    "The pilot's own cost is not yet known."
)
INPUTS = PMInput(
    objective="A decision memo under 1,000 words comparing B and C.",
    mode="architect",
    facts=[AcceptedFact(statement="The minimum cash reserve is $75,000.", kind="requirement")],
)
ACCEPTED = [
    AcceptedFinding(id="i4", stage_label="Check", finding="Setup-cost recovery is confused with operating break-even.", suggested_change="Separate the two."),
    AcceptedFinding(id="i7", stage_label="Check", finding="Financing repayments are missing from the break-even.", suggested_change="Include repayments."),
]


def test_the_prompt_names_both_checks_and_carries_the_record():
    system, user = build_prompt(INPUTS, "Final decision memo", MEMO, ACCEPTED)
    assert "ACCEPTED FINDINGS" in system and "CONTRADICTIONS" in system
    assert "a threshold said to justify a permanent decision when the text says it only covers running costs" in system
    assert "Never report style" in system
    assert "- i4 (Check): Setup-cost recovery is confused with operating break-even. — suggested change: Separate the two." in user
    assert "The minimum cash reserve is $75,000." in user
    assert MEMO in user


def test_a_contradiction_is_kept_only_with_both_passages_found():
    raw = {
        "contradictions": [
            {
                "rule_quote": "if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.",
                "conflicts_quote": "does not recover the $8,000 setup",
                "problem": "The adoption rule ignores that $8,000 only covers running costs.",
                "fix": "Require revenue above $8,000 by enough to recover the setup.",
            },
            {"rule_quote": "Open the second location in March.", "conflicts_quote": "does not recover the $8,000 setup", "problem": "Invented."},
            {"rule_quote": "A refundable or phased deposit could remove the upfront cash shortfall.", "conflicts_quote": "The minimum cash reserve is $75,000.", "problem": "A refundable deposit is still paid up front."},
        ]
    }
    got = parse(raw, INPUTS, MEMO, ACCEPTED).contradictions
    assert [c.problem for c in got] == [
        "The adoption rule ignores that $8,000 only covers running costs.",
        "A refundable deposit is still paid up front.",
    ]


def test_carried_needs_its_passage_and_unknown_ids_are_dropped():
    raw = {
        "findings": [
            {"id": "i4", "verdict": "carried", "quote": "does not recover the $8,000 setup"},
            {"id": "i7", "verdict": "carried", "quote": "Repayments are included in every break-even figure."},
            {"id": "i99", "verdict": "not_carried"},
        ]
    }
    got = parse(raw, INPUTS, MEMO, ACCEPTED).findings
    assert [(f.id, f.verdict) for f in got] == [("i4", "carried")]


def test_the_endpoint_returns_the_checked_result():
    stub = AsyncMock()
    stub.model = "test/model"
    stub.generate_json = AsyncMock(return_value=({"findings": [{"id": "i7", "verdict": "not_carried", "note": "No repayments anywhere."}], "contradictions": []}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post(
            "/api/agent/check-deliverable",
            json={"inputs": INPUTS.model_dump(), "deliverable_label": "Final decision memo", "content": MEMO, "accepted": [a.model_dump() for a in ACCEPTED]},
        )
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    assert r.json()["findings"] == [{"id": "i7", "verdict": "not_carried", "quote": "", "note": "No repayments anywhere."}]
    kwargs = stub.generate_json.call_args.kwargs
    assert "CONTRADICTIONS" in kwargs["system"] and MEMO in kwargs["prompt"]


def test_a_conditional_decision_memo_can_be_met_while_evidence_is_unknown():
    from promptmaster.objective_assessment import _ASSESS_INSTRUCTION

    assert "a conditional recommendation that says what is unknown and what evidence would change it MEETS it" in _ASSESS_INSTRUCTION
    assert "list it under proposed_next, never as unmet or a blocker" in _ASSESS_INSTRUCTION
    # The rule against conditional results still holds where the objective asks for a result itself.
    assert "Where the objective asks for a result itself" in _ASSESS_INSTRUCTION


def test_approving_a_stage_does_not_promote_its_assumptions():
    from promptmaster.agent import AgentState, build_next_action_prompt
    from promptmaster.saved_documents import DOCUMENTS_RULE

    assert "does not make each assumption, estimate or inference in it a confirmed fact" in DOCUMENTS_RULE
    _, user = build_next_action_prompt(INPUTS, AgentState(stage_id="memo", prior_stages=["Facts: complete"]), ["draft_stage"], "guided")
    assert "an assumption or inference in one is still an assumption, not a confirmed fact" in user
