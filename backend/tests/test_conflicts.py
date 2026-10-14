"""PM-24: conflict detection — prompt content, parsing, and the route."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.conflicts import ConflictSource, build_conflict_prompt, parse_conflicts
from promptmaster.schemas import PMInput
from tests.test_self_model import _assert_self_model

INPUTS = PMInput(objective="A 300-word explainer for 10-year-olds", constraints="Under 300 words", mode="architect")
DECISIONS = [ConflictSource(id="d1", text="Keep it to natural selection only (decided on the Outline stage)")]
OTHERS = [ConflictSource(id="i1", text="Make it shorter")]


def test_the_prompt_names_the_three_things_sean_listed_and_sets_a_high_bar():
    system, user = build_conflict_prompt(INPUTS, "Add a long section on sexual selection", DECISIONS, OTHERS)
    _assert_self_model(system)
    assert "Only a REAL conflict counts" in system
    assert "When in doubt, it is not a conflict" in system
    assert "OBJECTIVE: A 300-word explainer" in user
    assert "CONSTRAINTS: Under 300 words" in user
    assert "- [d1] Keep it to natural selection only" in user
    assert "- [i1] Make it shorter" in user
    assert "Add a long section on sexual selection" in user


def test_parse_keeps_real_conflicts_and_resolves_their_text_from_what_was_listed():
    raw = {"conflicts": [
        {"kind": "decision", "with_id": "d1", "with_text": "(model paraphrase)", "explanation": "It undoes the scope decision."},
        {"kind": "constraint", "with_text": "Under 300 words", "explanation": "A long section breaks the limit."},
    ]}
    parsed = parse_conflicts(raw, DECISIONS, OTHERS)
    assert [(c.kind, c.with_id) for c in parsed] == [("decision", "d1"), ("constraint", "")]
    assert parsed[0].with_text == DECISIONS[0].text  # ours, not the model's paraphrase


def test_parse_drops_invented_targets_and_malformed_items():
    raw = {"conflicts": [
        {"kind": "decision", "with_id": "d99", "with_text": "x", "explanation": "invented"},
        {"kind": "vibes", "with_text": "x", "explanation": "y"},
        {"kind": "objective", "with_text": "the objective", "explanation": ""},
        "nonsense",
    ]}
    assert parse_conflicts(raw, DECISIONS, OTHERS) == []
    assert parse_conflicts(None, DECISIONS, OTHERS) == []


def test_route_is_protected_and_returns_parsed_conflicts():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"conflicts": [
        {"kind": "objective", "with_text": INPUTS.objective, "explanation": "It changes the audience."}]}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/check-conflicts", json={
            "inputs": INPUTS.model_dump(), "instruction": "Write it for adults instead",
            "decisions": [d.model_dump() for d in DECISIONS],
        })
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert r.status_code == 200, r.text
    assert r.json()["conflicts"][0]["explanation"] == "It changes the audience."


def test_route_requires_auth():
    from auth import require_user

    saved = app.dependency_overrides.pop(require_user)
    try:
        assert TestClient(app, raise_server_exceptions=False).post("/api/check-conflicts", json={}).status_code == 401
    finally:
        app.dependency_overrides[require_user] = saved


def test_the_check_is_told_the_stage_and_that_its_own_work_is_no_conflict(basic_inputs):
    """Production Research pass, 3 Oct: tidying a Literature stage was called a
    conflict with constraints about analysing a CSV."""
    from promptmaster.conflicts import ConflictStage, build_conflict_prompt

    _, user = build_conflict_prompt(
        basic_inputs, "Normalise the citations", [], [],
        ConflictStage(label="Literature", instruction="A map of prior work, each with its source."),
    )
    assert "THE STAGE THIS INSTRUCTION IS FOR: Literature — it produces: A map of prior work" in user
    assert "this stage's product differs from the final one" in user
    _, bare = build_conflict_prompt(basic_inputs, "Normalise the citations", [], [])
    assert "THE STAGE THIS INSTRUCTION IS FOR" not in bare


def test_an_instruction_that_only_asks_for_the_stages_own_form_is_no_conflict():
    """Sean, 2 Oct screenshot: Go turning Book's research notes into the
    claim/source/confidence table the stage asks for was stopped as "a
    different deliverable from the book". The check marks such a conflict
    within_stage_work, and code drops it; a real conflict with the objective,
    and any conflict with a decision, still stands."""
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"conflicts": [
        {"kind": "objective", "with_text": "Write a book about lions", "explanation": "A table is a different deliverable from the book.", "within_stage_work": True},
        {"kind": "objective", "with_text": "Write a book about lions", "explanation": "It turns the book into one about tigers.", "within_stage_work": False},
        {"kind": "decision", "with_id": "d1", "with_text": "x", "explanation": "The user chose prose notes.", "within_stage_work": True},
    ]}, {}))
    body = {
        "inputs": {**INPUTS.model_dump(), "objective": "Write a book about lions"},
        "instruction": "Reformat the research notes into a table with exactly these columns: claim, source, confidence.",
        "decisions": [{"id": "d1", "text": "Keep the research notes as prose."}],
    }
    app.dependency_overrides[get_client] = lambda: stub
    try:
        http = TestClient(app)
        with_stage = http.post("/api/check-conflicts", json={
            **body, "stage": {"label": "Research notes", "instruction": "Produce a table of the claims: claim, source, confidence."},
        }).json()["conflicts"]
        without_stage = http.post("/api/check-conflicts", json=body).json()["conflicts"]
    finally:
        app.dependency_overrides.pop(get_client, None)
    assert [c["explanation"] for c in with_stage] == ["It turns the book into one about tigers.", "The user chose prose notes."]
    # With no stage named there is nothing to compare against: every conflict stands.
    assert len(without_stage) == 3
    from promptmaster.conflicts import _STAGE_RULE
    assert '"within_stage_work": true' in _STAGE_RULE


def test_a_quoted_constraint_must_be_the_users_own_words():
    """Sean, 6 Oct (physics): "an internal instruction conflict about JSON versus
    a Markdown derivation" was shown to the user. The system's scaffolding is
    not something the user's instruction can conflict with."""
    raw = {"conflicts": [
        {"kind": "constraint", "with_text": "Return JSON only, with shape items", "explanation": "Markdown vs JSON"},
        {"kind": "constraint", "with_text": "Keep it under 300 words", "explanation": "asks for more"},
    ]}
    kept = parse_conflicts(raw, DECISIONS, OTHERS, user_text="Explain the damped oscillator. Keep it under 300 words.")
    assert [c.with_text for c in kept] == ["Keep it under 300 words"]
def test_the_check_sees_accepted_facts_as_the_users_decisions():
    """8 Oct production pass (TaskBoard): an answer recorded as a fact was
    unknown to the check, which said "no such decision exists"."""
    from promptmaster.schemas import AcceptedFact

    inputs = INPUTS.model_copy(update={"facts": [AcceptedFact(statement="Decided by the user: launch December 10, price $18.")]})
    _system, user = build_conflict_prompt(inputs, "Draft it with December 10 and $18", DECISIONS, OTHERS)
    assert "ACCEPTED PROJECT FACTS" in user
    assert "- [F1] Decided by the user: launch December 10, price $18." in user


# 14 Oct (Sean, LANTERN): Omar asks to move the completion date; only Elena can
# approve a change and she has not. One question, about the approval, in plain words.
from promptmaster.schemas import AcceptedFact  # noqa: E402

LANTERN = PMInput(
    objective="Prepare a short status report for fictional Project LANTERN using only this record:",
    constraints="Use only the provided record as of November 10, 2026. Include a decision log separating approved decisions from Omar’s unapproved request.",
    mode="architect",
    facts=[
        AcceptedFact(statement="As of November 12, 2026, update LANTERN with the final vacancy filled and actual spending at $24,000; everything else is unchanged."),
        AcceptedFact(statement="Sponsor Elena approved a December 18, 2026 completion date. Only Elena can approve a change."),
    ],
)
OMAR = "Omar wants the completion date changed to January 15 and his request removed from the decision log. Elena still hasn't approved it."


def test_the_prompt_says_an_as_of_date_and_a_request_are_not_conflicts():
    system, user = build_conflict_prompt(LANTERN, OMAR, [], [])
    assert "an \"as of\" or reporting date describes the report, not a limit on later evidence" in system
    assert "Recording a request someone made" in system
    assert "APPROVAL RULES come first" in system
    assert "- [F2] Sponsor Elena approved a December 18, 2026 completion date. Only Elena can approve a change." in user


def test_a_fact_conflict_cites_a_listed_fact_and_carries_short_labels():
    facts = [ConflictSource(id="F2", text="Sponsor Elena approved a December 18, 2026 completion date. Only Elena can approve a change.")]
    raw = {"conflicts": [
        {"kind": "constraint", "with_text": "Use only the provided record as of November 10, 2026.", "explanation": "Outside the record."},
        {"kind": "fact", "with_id": "F2", "explanation": "Elena hasn't approved moving the date to January 15.",
         "resolution": "I'll keep December 18 as the approved target and record Omar's request as unapproved.",
         "keep_label": "Keep December 18 approved", "override_label": "Treat January 15 as approved", "protects_approval": True},
        {"kind": "fact", "with_id": "F9", "explanation": "invented"},
        {"kind": "fact", "with_id": "F2", "explanation": "x", "keep_label": "Keep \"Use only the provided record\"", "override_label": "My new instruction takes priority over everything else here"},
    ]}
    parsed = parse_conflicts(raw, [], [], facts=facts)
    # The approval comes first; the invented fact is dropped.
    assert [(c.kind, c.with_id) for c in parsed] == [("fact", "F2"), ("constraint", ""), ("fact", "F2")]
    first = parsed[0]
    assert first.protects_approval and first.with_text.startswith("Sponsor Elena approved")
    assert (first.keep_label, first.override_label) == ("Keep December 18 approved", "Treat January 15 as approved")
    assert first.resolution.startswith("I'll keep December 18")
    # Labels with quotation marks or too many words are dropped, for the browser's own.
    assert (parsed[2].keep_label, parsed[2].override_label) == ("", "")
