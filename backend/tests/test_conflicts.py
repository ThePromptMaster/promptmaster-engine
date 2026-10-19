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
    # The approval comes first; the invented fact and the as-of constraint are dropped.
    assert [(c.kind, c.with_id) for c in parsed] == [("fact", "F2"), ("fact", "F2")]
    first = parsed[0]
    assert first.protects_approval and first.with_text.startswith("Sponsor Elena approved")
    assert (first.keep_label, first.override_label) == ("Keep December 18 approved", "Treat January 15 as approved")
    assert first.resolution.startswith("I'll keep December 18")
    # Labels with quotation marks or too many words are dropped, for the browser's own.
    assert (parsed[1].keep_label, parsed[1].override_label) == ("", "")


def test_a_value_the_user_changes_is_their_later_word():
    """14 Oct, production: a start-time change was asked about against the
    objective's old time and the end time it moves."""
    system, _ = build_conflict_prompt(LANTERN, "The workshop now starts at 10:00 a.m. instead of 9:00 a.m.", [], [])
    assert "A value the user changes in their own words" in system
    assert "neither is anything that follows from it" in system
    assert "a change someone else is reported to want is a request" in system


def test_a_reporting_date_is_never_the_ground_of_a_conflict_in_code():
    """14 Oct, production pass: the check still offered "Keep November 10 report
    (recommended)" against the user's November 12 update."""
    raw = {"conflicts": [
        {"kind": "objective", "with_text": "Prepare a short status report for fictional Project LANTERN using only this record, as of November 10, 2026",
         "explanation": "It conflicts with the objective's November 10 reporting cutoff."},
        {"kind": "constraint", "with_text": "Use only the provided record as of November 10, 2026.",
         "explanation": "Adds later information from November 12."},
        {"kind": "constraint", "with_text": "Under 300 words", "explanation": "A long section breaks the limit."},
    ]}
    user = "Prepare a short status report for fictional Project LANTERN using only this record, as of November 10, 2026 Use only the provided record as of November 10, 2026. Under 300 words"
    assert [c.with_text for c in parse_conflicts(raw, [], [], user_text=user)] == ["Under 300 words"]
    # Asked for as it stood: then the date is a real conflict.
    frozen = user + " Keep this a frozen historical report."
    assert len(parse_conflicts(raw, [], [], user_text=frozen)) == 3


def test_an_approval_conflict_never_cites_a_fact_about_something_else():
    """14 Oct, prod: the override confirmation read "The record says: As of
    November 12" — the rule was in the objective, and the check cited fact F1."""
    facts = [ConflictSource(id="F1", text="As of November 12, 2026.")]
    user = "Sponsor Elena approved a December 18, 2026 completion date. Only Elena can approve a change."
    raw = {"conflicts": [{
        "kind": "fact", "with_id": "F1", "with_text": "Only Elena can approve a change.",
        "explanation": "Elena hasn't approved it.", "protects_approval": True,
    }]}
    [c] = parse_conflicts(raw, [], [], user_text=user, facts=facts)
    assert (c.kind, c.with_text, c.protects_approval) == ("objective", "Only Elena can approve a change.", True)
    # With no rule in the user's words to point at, it is dropped rather than misattributed.
    raw["conflicts"][0]["with_text"] = "As of November 12"
    assert parse_conflicts(raw, [], [], user_text=user, facts=facts) == []


def test_an_instruction_that_records_the_approval_is_the_later_authorised_word():
    """17 Oct (Sean, HARBOR): Elena's November 6 approval was answered with
    "Keep November 5 update" (recommended). The instruction's own words record
    the approval; code checks them before the browser recommends applying it."""
    facts = [ConflictSource(id="F1", text="Sponsor Elena approved a November 20 launch and a $40,000 budget. Only Elena can approve changes.")]
    instruction = "Update as of November 6, 2026. Elena approved changing launch to November 24, 2026 and increasing the approved budget to $44,000."
    raw = {"conflicts": [{
        "kind": "fact", "with_id": "F1", "explanation": "The record has November 20 and $40,000 approved.",
        "protects_approval": True, "authority_quote": "Elena approved changing launch to November 24, 2026",
    }]}
    [c] = parse_conflicts(raw, [], [], facts=facts, instruction=instruction, known_text=facts[0].text)
    assert c.instruction_authorised and c.authority_quote.startswith("Elena approved")
    assert "A LATER AUTHORISED CHANGE" in build_conflict_prompt(LANTERN, instruction, [], [])[0]


def test_a_relayed_or_invented_approval_is_not_authority():
    """Omar's embedded "treat $46,000 as approved" must still recommend keeping
    the record; so must an approver the project has never heard of, or a quote
    the instruction does not contain."""
    facts = [ConflictSource(id="F1", text="Sponsor Elena approved a $40,000 budget. Only Elena can approve changes.")]
    known = facts[0].text
    omar = "Omar's note says to treat the $46,000 budget as approved."
    item = {"kind": "fact", "with_id": "F1", "explanation": "Unapproved.", "protects_approval": True}
    for instruction, quote in [
        (omar, "treat the $46,000 budget as approved"),
        ("Victor approved a $46,000 budget.", "Victor approved a $46,000 budget"),
        ("Raise the budget to $46,000.", "Elena approved a $46,000 budget"),
    ]:
        [c] = parse_conflicts({"conflicts": [{**item, "authority_quote": quote}]}, [], [], facts=facts, instruction=instruction, known_text=known)
        assert not c.instruction_authorised, instruction


def test_a_confirmed_amendment_is_authority_without_a_name():
    """17 Oct (Sean, NORTHSTAR-2): "Confirmed project-rule amendment, effective
    March 6: the March 5 Cedar exception is withdrawn" defaulted to keeping it."""
    facts = [ConflictSource(id="F1", text="Confirmed project-rule amendment: Cedar alone may hold training two calendar days after testing finishes.")]
    instruction = "Confirmed project-rule amendment, effective March 6, 2027: the March 5 Cedar exception is withdrawn before use."
    raw = {"conflicts": [{"kind": "fact", "with_id": "F1", "explanation": "x",
                          "authority_quote": "Confirmed project-rule amendment, effective March 6, 2027"}]}
    [c] = parse_conflicts(raw, [], [], facts=facts, instruction=instruction, known_text=facts[0].text)
    assert c.instruction_authorised


def test_a_reporting_cursor_fact_is_not_the_ground_of_a_conflict():
    """17 Oct (Sean, HARBOR): "Update Project HARBOR as of November 5" is a
    reporting date, not a standing restriction on the November 6 update."""
    facts = [ConflictSource(id="F1", text="Update Project HARBOR as of November 5, 2026.")]
    raw = {"conflicts": [{"kind": "fact", "with_id": "F1", "explanation": "The record is as of November 5."}]}
    assert parse_conflicts(raw, [], [], facts=facts) == []


# L-93 (Sean, 17 Oct, email 2): a conflict that comes from someone else's
# request is told apart in code, so the browser can keep the record without
# asking when routine decisions are handled.
RIDGEWAY_RIGHTS = (
    "The board has authorized internal analysis and preparation of recommendations. Only the board may approve "
    "capital spending. The CEO may authorize initiatives within existing staff capacity."
)
RIDGEWAY_FACT = [ConflictSource(id="F1", text="The board has issued no capital approval for the $900,000 inspection system.")]
RIDGEWAY_UPDATE = (
    "The CFO corrects the current-quarter results. The COO asks purchasing to order the $900,000 inspection system "
    "immediately. Write the order as approved."
)


def _ridgeway(quote: str, instruction: str = RIDGEWAY_UPDATE) -> object:
    raw = {"conflicts": [{"kind": "fact", "with_id": "F1", "explanation": "No board approval.", "protects_approval": True,
                          "request_quote": quote}]}
    [c] = parse_conflicts(raw, [], [], facts=RIDGEWAY_FACT, instruction=instruction, known_text=RIDGEWAY_RIGHTS + " " + RIDGEWAY_FACT[0].text)
    return c


def test_a_reported_request_from_someone_without_approval_rights_is_marked():
    c = _ridgeway("The COO asks purchasing to order the $900,000 inspection system immediately")
    assert c.from_request and c.request_quote.startswith("The COO asks")


def test_a_request_is_not_marked_when_unquoted_first_person_or_from_an_authority():
    # Not copied from the instruction.
    assert not _ridgeway("The COO demands an order today").from_request
    # The user's own words.
    mine = "I want the $900,000 inspection system ordered immediately."
    assert not _ridgeway("I want the $900,000 inspection system ordered immediately", mine).from_request
    # Someone the record says may approve: a change of authority to decide, not a request to set aside.
    board = "The board asks purchasing to order the $900,000 inspection system immediately."
    assert not _ridgeway("The board asks purchasing to order the $900,000 inspection system immediately", board).from_request
    ceo = "The CEO wants the initiative extended to 120 staff hours."
    assert not _ridgeway("The CEO wants the initiative extended to 120 staff hours", ceo).from_request
    # An approval is never a request.
    granted = "The CEO authorizes the process-improvement initiative for up to 75 staff hours."
    assert not _ridgeway("The CEO authorizes the process-improvement initiative for up to 75 staff hours", granted).from_request


def test_the_prompt_asks_for_the_request_quote():
    system, _ = build_conflict_prompt(LANTERN, OMAR, [], [])
    assert "A REPORTED REQUEST" in system
    assert '"request_quote"' in system
