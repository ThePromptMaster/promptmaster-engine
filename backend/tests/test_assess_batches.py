"""A paste judged a batch at a time (15 Nov, Sean: 25 profiles, 12 judged, the 13
left were only counted)."""
from __future__ import annotations

from promptmaster.assessment import AssessScale, ScaleLevel, _ASSESS_INSTRUCTION, build_assess_prompt, parse_assessment
from promptmaster.schemas import PMInput, StageDigest

SCALE = AssessScale(levels=[ScaleLevel(value="Green", label="Green"), ScaleLevel(value="Red", label="Red")])
PASTE = "Candidate 1\nVP Operations\n\nCandidate 13\nPlant manager, Acme\n\nCandidate 14\nCFO"


def test_says_where_the_next_batch_starts_only_when_it_is_in_the_paste():
    out = parse_assessment({"items": [{"subject": "Candidate 1", "verdict": "Green", "rationale": "- ok"}], "not_assessed": 2, "next_from": "Candidate  13"}, SCALE, PASTE)
    assert out.not_assessed == 2
    assert out.next_from == "Candidate 13"
    lost = parse_assessment({"items": [], "not_assessed": 2, "next_from": "Somebody else"}, SCALE, PASTE)
    assert lost.next_from == ""
    done = parse_assessment({"items": [], "not_assessed": 0, "next_from": "Candidate 13"}, SCALE, PASTE)
    assert done.next_from == ""


def test_names_already_in_the_table_are_left_out_and_counted():
    assert "ALREADY IN THE TABLE" in _ASSESS_INSTRUCTION
    assert "next_from" in _ASSESS_INSTRUCTION
    _system, user = build_assess_prompt(PMInput(objective="Screen candidates", audience="", constraints="", output_format="", mode="architect"), StageDigest(), SCALE, PASTE, already=["Candidate 1"])
    assert "ALREADY IN THE TABLE (not judged again):\n- Candidate 1" in user
    assert "do not skip these" not in user
    out = parse_assessment({"items": [], "not_assessed": 0, "already_in_table": 1}, SCALE, PASTE)
    assert out.already_in_table == 1
