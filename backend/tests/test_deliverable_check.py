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


def test_a_term_stated_of_a_whole_amount_is_a_contradiction_to_look_for():
    """4 Nov (Sean, support-software memo): "$3,380 … nonrefundable" when only
    the $2,880 subscription was supplied as nonrefundable."""
    from promptmaster.deliverable_check import _INSTRUCTION

    assert "a term the facts give for only part of an amount stated of the whole of it" in _INSTRUCTION


def test_a_statement_a_table_on_record_contradicts_is_found_with_the_row_quoted():
    """4 Nov (Sean): "In Research, the narrative and evidence table disagreed about
    what had been reproduced." The write-up is checked against the outcome tables
    it reports on; the conflict must quote a row that is there."""
    from promptmaster.deliverable_check import RecordedTable, build_prompt, parse
    from promptmaster.schemas import PMInput

    inputs = PMInput(objective="Report what was reproduced.", mode="analyst")
    table = RecordedTable(label="Validation", rows="- v1: Effect of dose on recovery | 12 runs — status: Not reproduced\n- v2: Baseline rate | 3 runs — status: Independently reproduced")
    text = "Both results were independently reproduced, so the effect of dose on recovery is established."
    _, user = build_prompt(inputs, "Write-up", text, [], [table])
    assert "TABLES ON RECORD THAT THE DELIVERABLE REPORTS ON" in user and "### Validation" in user
    raw = {"findings": [], "contradictions": [
        {"rule_quote": "Both results were independently reproduced", "conflicts_quote": "v1: Effect of dose on recovery | 12 runs — status: Not reproduced", "problem": "The table says v1 was not reproduced.", "fix": "Say only v2 was reproduced."},
        {"rule_quote": "Both results were independently reproduced", "conflicts_quote": "v3: Something never in the table", "problem": "x"},
    ]}
    out = parse(raw, inputs, text, [], [table])
    assert len(out.contradictions) == 1
    assert out.contradictions[0].conflicts_quote.startswith("v1: Effect of dose")
    # Without the table, the row quote is not on record, so nothing is kept.
    assert parse(raw, inputs, text, []).contradictions == []


def test_a_text_past_the_limit_is_read_in_part_and_says_so_rather_than_refused():
    """5 Nov: over 200,000 characters the route answered 422, recorded only as
    "the check could not run"."""
    from promptmaster.deliverable_check import MAX_CHECK_CONTENT, build_prompt
    from promptmaster.schemas import PMInput

    book = "\n\n".join(f"## Chapter {i}\n\nOPENING{i} " + "word " * 10_000 for i in range(1, 8))
    assert len(book) > MAX_CHECK_CONTENT
    _, user = build_prompt(PMInput(objective="Report what was reproduced.", mode="analyst"), "Book", book, [])
    assert "OPENING7 " in user and "the rest of this section is not shown" in user


def test_quotes_the_note_makes_that_the_text_does_not_hold_are_put_to_the_check():
    """5 Nov: the delivered note quoted "I'm approving it at 2:30" as still in the book."""
    from promptmaster.deliverable_check import build_prompt

    _, user = build_prompt(INPUTS, "Book", "## Chapter 4\n\nSam approves 2pm.", [], None, ["I'm approving it at 2:30, not 2."])
    assert "THE DOCUMENT'S OWN REVIEW NOTE QUOTES" in user
    assert "I'm approving it at 2:30, not 2." in user
    assert "A note may quote an earlier draft" in user
    assert "THE DOCUMENT'S OWN REVIEW NOTE QUOTES" not in build_prompt(INPUTS, "Book", "Text.", [])[1]


def test_a_follow_through_gap_needs_only_its_own_passage():
    raw = {"gaps": [
        {"quote": "if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.", "problem": "No basis for the threshold in the facts.", "fix": "Make it conditional."},
        {"quote": "A sentence the memo does not hold.", "problem": "Invented."},
        {"quote": "if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.", "problem": ""},
    ]}
    got = parse(raw, INPUTS, MEMO, ACCEPTED).contradictions
    assert [(c.rule_quote, c.conflicts_quote, c.problem) for c in got] == [
        ("if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.", "", "No basis for the threshold in the facts.")
    ]


def test_the_check_is_told_to_look_for_follow_through():
    system, _user = build_prompt(INPUTS, "Final decision memo", MEMO, ACCEPTED)
    for words in ("FOLLOW-THROUGH", "follow from its financial analysis", "a deadline it gives someone that the user did not supply", "worked out on numbers that changed after it was made"):
        assert words in system


def test_readiness_is_put_beside_the_checklist():
    """9 Nov: as one clause of a list, the rule let a saved package through. It said the event was
    deliverable once one hour was covered, with the trainer, room and equipment still to book."""
    system, _user = build_prompt(INPUTS, "the package", MEMO, [])
    for words in ("4. READINESS", "deliverable only when X", "send this only after X", "the two do not agree", "the sentence as rule_quote, the list item as conflicts_quote", "covers them"):
        assert words in system
    package = (
        "One gap blocks it. The event becomes deliverable only when the Tuesday hour is covered.\n"
        "| 7 | Book or confirm the trainer, room and equipment for both dates. |\n"
    )
    raw = {"contradictions": [
        {"rule_quote": "The event becomes deliverable only when the Tuesday hour is covered.", "conflicts_quote": "Book or confirm the trainer, room and equipment for both dates.", "problem": "The checklist still has bookings the verdict does not name.", "fix": "Name them."},
        {"rule_quote": "The event becomes deliverable only when the Tuesday hour is covered.", "conflicts_quote": "Hire a band for the evening.", "problem": "Not in the text."},
    ]}
    got = parse(raw, INPUTS, package, []).contradictions
    assert [c.conflicts_quote for c in got] == ["Book or confirm the trainer, room and equipment for both dates."]


def test_a_past_date_is_not_a_deadline_the_check_can_call_unsupported():
    """9 Nov: a decision dated 7 Nov was reported as invented on every run, because the check is not
    shown the project's history, and a repair would have removed a true date."""
    system, _user = build_prompt(INPUTS, "the package", MEMO, [])
    assert "the date of a decision or event that has already happened is not a deadline" in system


def test_an_old_suggestion_on_a_changed_total_is_named():
    """7 Nov: a suggestion of six more attendees was costed as six on top of a total that had since
    risen by four, and nothing said the six were separate from the four."""
    system, _user = build_prompt(INPUTS, "the package", MEMO, [])
    assert "as six on top of a total that has since risen" in system
    assert "even in a list of things not adopted" in system



def test_the_check_is_shown_the_brief():
    """9 Nov (a finished package): what the brief required read as unsupported, and a
    deadline nobody supplied passed, because the check never saw the brief's constraints."""
    inputs = INPUTS.model_copy(update={"constraints": "None of the three fees has been paid yet."})
    system, user = build_prompt(inputs, "the package", MEMO, [])
    assert "THE BRIEF'S CONSTRAINTS" in user
    assert "None of the three fees has been paid yet." in user
    assert "never report it as unsupported" in system
    assert "the user did not supply" in system
    assert "committed or owed when the record says only approved" in system
    assert "THE BRIEF'S CONSTRAINTS" not in build_prompt(INPUTS.model_copy(update={"constraints": ""}), "the package", MEMO, [])[1]


def test_a_conflict_may_quote_the_brief():
    inputs = INPUTS.model_copy(update={"constraints": "At least $3,000 must remain uncommitted throughout."})
    raw = {"contradictions": [{
        "rule_quote": "Decision rule: if pilot revenue holds at or above $8,000 a month, adopt B on a continuing basis.",
        "conflicts_quote": "At least $3,000 must remain uncommitted throughout.",
        "problem": "Adopting B commits the reserve.",
        "fix": "Make it conditional.",
    }]}
    assert len(parse(raw, inputs, MEMO, []).contradictions) == 1
    # A quote from nothing supplied is still dropped.
    assert parse(raw, INPUTS.model_copy(update={"constraints": ""}), MEMO, []).contradictions == []
