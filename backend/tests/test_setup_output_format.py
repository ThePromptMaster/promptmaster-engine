"""2 Nov prod pass: after "drop option A" the output format still read
"Options A–C assessed". A setup change may now rewrite the output format."""
from promptmaster.revision_facts import ProjectSetup, RevisionFactsRequest, build_prompt, parse

INSTRUCTION = "Change of scope: drop option A entirely, compare only B and C. The reserve is now $75,000, not $40,000."


def _req() -> RevisionFactsRequest:
    return RevisionFactsRequest(
        instruction=INSTRUCTION,
        before="Options A, B and C against $40,000.",
        after="Options B and C against $75,000.",
        setup=ProjectSetup(
            objective="Compare three options: A, B, C.",
            constraints="Under 1,000 words. $40,000 reserve.",
            output_format="Decision / Criteria / Options A–C assessed / Recommendation",
        ),
    )


def test_prompt_shows_and_offers_the_output_format():
    system, prompt = build_prompt(_req())
    assert "OUTPUT FORMAT: Decision / Criteria / Options A–C assessed" in prompt
    assert "OUTPUT FORMAT" in system and '"output_format"' in system


def test_all_three_setup_fields_are_kept():
    raw = {"setup_changes": [
        {"field": "objective", "proposed": "Compare two options: B, C.", "quote": "compare only B and C."},
        {"field": "constraints", "proposed": "Under 1,000 words. $75,000 reserve.", "quote": "The reserve is now $75,000, not $40,000."},
        {"field": "output_format", "proposed": "Decision / Criteria / Options B–C assessed / Recommendation", "quote": "drop option A entirely"},
    ]}
    out = parse(raw, _req()).setup_changes
    assert [c.field for c in out] == ["objective", "constraints", "output_format"]


def test_unknown_field_and_unchanged_format_are_dropped():
    raw = {"setup_changes": [
        {"field": "audience", "proposed": "Someone else entirely", "quote": "drop option A entirely"},
        {"field": "output_format", "proposed": "Decision / Criteria / Options A–C assessed / Recommendation", "quote": "drop option A entirely"},
    ]}
    assert parse(raw, _req()).setup_changes == []
