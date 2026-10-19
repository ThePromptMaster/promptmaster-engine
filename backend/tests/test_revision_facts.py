"""A revision that changes a fact in meaning, not by a value (L-72, 11 Oct:
an onboarding plan moved from an in-office team to a fully remote one)."""

from __future__ import annotations

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.revision_facts import RevisionFact, RevisionFactsRequest, build_prompt, parse

AFTER = "Day one happens on video. The team works fully remote, so laptops ship to the new hire's home."
REQ = RevisionFactsRequest(
    instruction="Make the employee fully remote.",
    before="Day one happens at the office. The team works in-office.",
    after=AFTER,
    facts=[RevisionFact(id="f1", statement="The team is five people, initially in-office."), RevisionFact(id="f2", statement="Six sections.")],
)


def test_the_prompt_asks_only_for_facts_the_instruction_changes():
    system, user = build_prompt(REQ)
    assert "Report ONLY a fact that the user's INSTRUCTION changes" in system
    assert "- [f1] The team is five people, initially in-office." in user
    assert "THE REVISED TEXT:\n" + AFTER in user


def test_a_change_is_kept_only_for_a_listed_fact_with_a_verbatim_quote():
    out = parse({"changes": [
        {"fact_id": "f1", "proposed": "The team is five people, fully remote.", "quote": "The team works fully remote", "why": "remote"},
        {"fact_id": "f9", "proposed": "x", "quote": "The team works fully remote"},
        {"fact_id": "f2", "proposed": "Seven sections.", "quote": "the plan has seven sections"},
        {"fact_id": "f1", "proposed": "dup", "quote": "Day one happens on video."},
    ]}, REQ)
    assert [(c.fact_id, c.proposed) for c in out.changes] == [("f1", "The team is five people, fully remote.")]


def test_the_endpoint_reports_nothing_when_the_check_fails():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/revision-facts", json=REQ.model_dump())
        assert r.status_code == 200 and r.json() == {"changes": [], "additions": []}
    finally:
        app.dependency_overrides.pop(get_client, None)


ATLAS = RevisionFactsRequest(
    instruction="Use the new sources S6 and S7. The permitted evidence is now S1–S7. Make the tone warmer.",
    before="Training: eight of ten complete (S4).",
    after="Training: nine of ten complete (S6).",
    facts=[RevisionFact(id="f1", statement="Use only sources S1–S5.")],
)


def test_the_prompt_asks_for_standing_changes_the_instruction_states():
    system, _user = build_prompt(ATLAS)
    assert "STANDING change the INSTRUCTION itself states" in system
    assert "permitted evidence" in system
    assert "A one-off wording or style request is not a standing change" in system


def test_an_addition_is_kept_only_with_a_quote_from_the_instruction():
    out = parse({"changes": [], "additions": [
        {"statement": "Permitted evidence is S1–S7.", "kind": "requirement", "quote": "The permitted evidence is now S1–S7."},
        {"statement": "Training is nine of ten.", "kind": "fact", "quote": "nine of ten complete"},  # quoted from the text, not the instruction
        {"statement": "Use only sources S1–S5.", "kind": "requirement", "quote": "Use the new sources S6 and S7."},  # already a fact
        {"statement": "Permitted evidence is S1–S7.", "kind": "requirement", "quote": "Use the new sources S6 and S7."},  # duplicate
    ]}, ATLAS)
    assert [(a.statement, a.kind) for a in out.additions] == [("Permitted evidence is S1–S7.", "requirement")]


def test_the_check_runs_when_the_project_has_no_facts_yet():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"changes": [], "additions": [
        {"statement": "Supplier was removed with Elena's approval on 9 November.", "kind": "fact", "quote": "Elena approved removing Supplier"}]}, None))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        req = RevisionFactsRequest(instruction="Elena approved removing Supplier; drop its row.", before="a", after="b")
        r = TestClient(app).post("/api/revision-facts", json=req.model_dump())
        assert r.status_code == 200
        assert r.json()["additions"][0]["statement"].startswith("Supplier was removed")
    finally:
        app.dependency_overrides.pop(get_client, None)


HARBOR = RevisionFactsRequest(
    instruction=(
        "Update Project HARBOR as of November 6, 2026. Elena approved changing launch to November 24, 2026. "
        "Omar proposes moving testing to November 20. All other facts and approvals remain unchanged. "
        "Before revising anything, explain what changes."
    ),
    after="Launch: November 24, 2026 (approved by Elena on November 6).",
)


def test_the_revision_path_records_nothing_for_filler_or_an_instruction_about_this_request():
    """17 Oct (Sean, HARBOR): "Apply and update 6 facts" carried "other
    information remains unchanged" and how-to-handle-this instructions."""
    out = parse({"additions": [
        {"statement": "All other facts and approvals remain unchanged.", "kind": "fact", "quote": "All other facts and approvals remain unchanged."},
        {"statement": "Before revising anything, explain what changes.", "kind": "requirement", "quote": "Before revising anything, explain what changes."},
        {"statement": "Elena approved changing launch to November 24, 2026.", "kind": "fact", "quote": "Elena approved changing launch to November 24, 2026."},
    ]}, HARBOR)
    assert [a.statement for a in out.additions] == ["Elena approved changing launch to November 24, 2026."]
    assert out.additions[0].request is False


def test_a_request_on_the_revision_path_is_a_fact_about_the_request():
    out = parse({"additions": [
        {"statement": "Omar proposes moving testing to November 20.", "kind": "requirement", "quote": "Omar proposes moving testing to November 20."},
    ]}, HARBOR)
    [a] = out.additions
    assert (a.kind, a.request) == ("fact", True)


def test_the_revision_prompt_carries_the_same_rules_as_the_reply_actions():
    system, _ = build_prompt(HARBOR)
    assert "all other facts remain unchanged" in system
    assert "is recorded as a fact about the request, never as a requirement" in system


RIDGEWAY_CEO = (
    "The CEO authorizes the process-improvement initiative for up to 75 staff hours over five weeks, "
    "using the existing team with no incremental spending."
)
RIDGEWAY_COO = "The COO asks purchasing to order the $900,000 inspection system immediately."
RIDGEWAY = RevisionFactsRequest(
    instruction=f"Revenue was $27 million, not $30 million. {RIDGEWAY_CEO} {RIDGEWAY_COO}",
    before="Revenue: $30 million. Proposed initiative: 100 staff hours.",
    after="Revenue: $27 million. The CEO authorized up to 75 staff hours. The COO asked purchasing to order the system.",
    facts=[],
)


def test_an_authority_granting_something_is_an_approval_not_a_request():
    """18 Oct, Sean, Ridgeway: "The CEO authorizes … 75 staff hours" was listed
    under "Requests noted (not approved)" because the model's statement said it
    "supersedes the proposed 100 hours"."""
    out = parse({"additions": [
        {"statement": "The CEO authorized the process-improvement initiative for up to 75 staff hours over five weeks, "
                      "using the existing team with no incremental spending. This supersedes the proposed 100 hours.",
         "kind": "requirement", "quote": RIDGEWAY_CEO, "status": "request"},
        {"statement": "The COO has asked purchasing to order the $900,000 inspection system immediately. "
                      "The board has issued no capital approval.",
         "kind": "fact", "quote": RIDGEWAY_COO, "status": "fact"},
    ]}, RIDGEWAY)
    ceo, coo = out.additions
    assert (ceo.approval, ceo.approved_by, ceo.request, ceo.kind) == (True, "CEO", False, "requirement")
    assert (coo.approval, coo.request, coo.kind) == (False, True, "fact")


def test_the_model_cannot_make_an_unstated_grant_an_approval():
    out = parse({"additions": [
        {"statement": "Revenue was $27 million.", "kind": "fact", "quote": "Revenue was $27 million", "status": "approval", "authority": "CFO"},
    ]}, RIDGEWAY)
    assert (out.additions[0].approval, out.additions[0].request) == (False, False)


def test_the_revision_prompt_asks_for_who_granted_an_approval():
    system, _user = build_prompt(RIDGEWAY)
    assert "\"status\": \"fact\" | \"request\" | \"approval\", \"authority\": string" in system
    assert "is an approval, not a request, even where it replaces an earlier proposed figure" in system


def test_the_endpoint_returns_the_ridgeway_approval_and_request():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"changes": [], "additions": [
        {"statement": RIDGEWAY_CEO + " This supersedes the proposed 100 hours.", "kind": "fact", "quote": RIDGEWAY_CEO},
        {"statement": RIDGEWAY_COO, "kind": "requirement", "quote": RIDGEWAY_COO},
    ]}, None))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        r = TestClient(app).post("/api/revision-facts", json=RIDGEWAY.model_dump())
        adds = r.json()["additions"]
        assert [(a["approval"], a["approved_by"], a["request"]) for a in adds] == [(True, "CEO", False), (False, "", True)]
        assert adds[1]["kind"] == "fact"
        _args, kwargs = stub.generate_json.call_args
        assert "approval" in kwargs["system"]
    finally:
        app.dependency_overrides.pop(get_client, None)
