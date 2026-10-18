"""Statements that something stays as recorded are not new facts (18 Oct, L-89)."""

import pytest

from promptmaster.fact_filters import records_nothing, the_change
from promptmaster.revision_facts import RevisionFactsRequest, parse
from promptmaster.reply_actions import parse_record_facts


@pytest.mark.parametrize("statement", [
    # Production wordings stored as facts or requirements on the REEF pass.
    "All other requirements remain unchanged.",
    "The existing rules requiring training before launch remain unchanged.",
    "All existing dependency and duration rules remain unchanged.",
    "Keep the readiness review as it was.",
    "Leave the task tracker unchanged.",
    "Keep the decision log the same.",
])
def test_a_statement_that_something_stays_as_recorded_records_nothing(statement):
    assert records_nothing(statement)


@pytest.mark.parametrize("statement", [
    "Testing will take 5 days.",
    "Training is now complete.",
    "The budget remains $44,000.",
    "Elena approved the November 24 launch.",
])
def test_a_genuine_fact_is_still_recorded(statement):
    assert not records_nothing(statement)


def test_only_the_change_after_except_is_kept():
    s = "All other facts, approvals, owners, and task statuses remain unchanged except that training is now complete."
    assert the_change(s) == "Training is now complete."
    assert the_change("Testing will take 5 days.") == "Testing will take 5 days."


def test_a_revision_offers_the_change_not_the_preface():
    instruction = (
        "All existing dependency and duration rules remain unchanged. "
        "All other facts, approvals, owners, and task statuses remain unchanged except that training is now complete."
    )
    req = RevisionFactsRequest(instruction=instruction, before="old", after="new", facts=[])
    out = parse({"additions": [
        {"statement": "All existing dependency and duration rules remain unchanged.", "kind": "requirement",
         "quote": "All existing dependency and duration rules remain unchanged."},
        {"statement": "All other facts, approvals, owners, and task statuses remain unchanged except that training is now complete.",
         "kind": "fact", "quote": "remain unchanged except that training is now complete"},
    ]}, req)
    assert [a.statement for a in out.additions] == ["Training is now complete."]


def test_a_chat_reply_does_not_record_keep_as_it_was():
    question = "Keep the readiness review as it was. Testing will take 5 days."
    facts = parse_record_facts({"facts": [
        {"statement": "Keep the readiness review as it was.", "kind": "requirement"},
        {"statement": "Testing will take 5 days.", "kind": "fact"},
    ]}, question)
    assert [f.statement for f in facts] == ["Testing will take 5 days."]
