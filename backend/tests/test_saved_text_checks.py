"""A check verifies the saved text (A1, 8 Oct; Sean, 7 Oct, TeamNotes)."""

from __future__ import annotations

from promptmaster.saved_text_checks import VERIFY_RULE, disproved_missing
from promptmaster.stage_evaluation import parse_stage_evaluation

FAQ = "Q2. Is there a mobile app? No — there is no mobile app at launch. Q4. How do I use it? Through a web browser."


def test_a_missing_claim_the_saved_text_disproves_is_dropped():
    assert disproved_missing('The FAQ does not state "no mobile app".', FAQ)
    assert disproved_missing('Missing: "web browser" access is not confirmed.', FAQ)
    # The words really are absent: kept.
    assert not disproved_missing('Missing: "free trial" is not addressed.', FAQ)
    # Nothing quoted: cannot be verified either way, kept.
    assert not disproved_missing("The FAQ omits the mobile app.", FAQ)
    # Not a claim that something is missing.
    assert not disproved_missing('Says "no mobile app" twice.', FAQ)


def test_the_check_drops_such_a_finding_and_keeps_the_rest():
    raw = {
        "alignment": {"score": "High", "explanation": "ok"},
        "drift": {"score": "Low", "explanation": "ok"},
        "clarity": {"score": "High", "explanation": "ok"},
        "findings": [
            {"id": "a", "category": "objective", "summary": 'The FAQ does not mention "no mobile app".', "suggested_change": "Add it."},
            {"id": "b", "category": "objective", "summary": 'The FAQ does not mention "price".', "suggested_change": "Add it."},
        ],
    }
    kept = parse_stage_evaluation(raw, FAQ).evaluation.findings
    assert [f.id for f in kept] == ["b"]


def test_the_rule_says_count_and_quote():
    assert "count the items in the saved text" in VERIFY_RULE
    assert "double quotes" in VERIFY_RULE
