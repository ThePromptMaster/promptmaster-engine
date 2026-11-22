"""The options a reserved approval offers, read from the stage's text (12 Nov)."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.decision_options import (
    MAX_OPTIONS, OPTIONS_INSTRUCTION, OPTIONS_MODEL, DecisionOptionsRequest, build_options_prompt, parse_options,
    plainly_signs_off,
)
from promptmaster.mock_llm import _json_reply
from promptmaster.schemas import PMInput

STAGE = (
    "# Decide on the cap change\n\n"
    "Status: Awaiting the user's decision.\n\n"
    "- Option A: raise the cap to $195,000 per hire for both searches. Morgan and Jordan join the shortlists.\n"
    "- Option B: keep the approved cap of $180,000 per hire. The shortlists stay as they are.\n"
)


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _inputs(**over) -> dict:
    return {"objective": "Shortlists for two searches.", "audience": "", "constraints": "Only I can approve a cap change.", "output_format": "", "mode": "architect", **over}


def _req(**over) -> DecisionOptionsRequest:
    return DecisionOptionsRequest(**{"inputs": PMInput(**_inputs()), "approval": "I approve this decision on the cap.", "stage_label": "Cap decision", "content": STAGE, **over})


def test_prompt_carries_the_approval_the_stage_text_and_the_users_facts():
    req = _req(inputs=PMInput(**_inputs(facts=[{"statement": "Approved cap: $180,000 per hire.", "kind": "fact"}])))
    system, user = build_options_prompt(req)
    assert system == OPTIONS_INSTRUCTION
    assert "THE APPROVAL: I approve this decision on the cap." in user
    assert "THE STAGE: Cap decision" in user
    assert "Option A: raise the cap to $195,000" in user
    assert "Approved cap: $180,000 per hire." in user
    assert "Only I can approve a cap change." in user
    assert "Never write an option the text does not state" in system
    assert "never recommend one" in system


def test_an_option_is_kept_only_with_its_passage_found_in_the_text():
    out = parse_options({"approval_asks": "choice", "question": "Raise the cap or keep it?", "options": [
        {"label": "Option A: raise the cap to $195,000 for both searches", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Option B: keep the $180,000 cap", "quote": "Option B: keep the approved cap of $180,000 per hire."},
        {"label": "Option C: raise it for the Controller search only", "quote": "Option C: raise the cap for the Controller search only."},
    ]}, STAGE)
    assert [o.label for o in out.options] == ["Option A: raise the cap to $195,000 for both searches", "Option B: keep the $180,000 cap"]
    assert out.question == "Raise the cap or keep it?"


def test_one_traceable_option_is_no_choice():
    out = parse_options({"approval_asks": "choice", "question": "?", "options": [
        {"label": "Option A", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Something else entirely", "quote": "A passage the stage does not hold at all."},
    ]}, STAGE)
    assert out.options == [] and out.question == ""


def test_the_same_option_twice_is_one_and_there_are_never_more_than_four():
    quote = "Option A: raise the cap to $195,000 per hire for both searches."
    out = parse_options({"approval_asks": "choice", "options": [{"label": "Option A", "quote": quote}, {"label": "option a.", "quote": quote}]}, STAGE)
    assert out.options == []
    text = "\n".join(f"Option {n}: do the thing numbered {n} for this plan." for n in "ABCDEF")
    out = parse_options({"approval_asks": "choice", "options": [{"label": f"Option {n}", "quote": f"Option {n}: do the thing numbered {n} for this plan."} for n in "ABCDEF"]}, text)
    assert len(out.options) == MAX_OPTIONS


PROPOSAL = (
    "# Proposal: Supervisor Workshop\n\n"
    "## 4. Options and fees\n\n"
    "- Option A: Core Workshop. A three-hour workshop with all participant materials for 28 supervisors.\n"
    "- Option B: Workshop with Preparation and Follow-Up. Option A plus a briefing call, a survey and a follow-up session.\n\n"
    "The client selects one option by signing the acceptance below.\n"
)
_BOTH = [
    {"label": "Option A: Core Workshop", "quote": "Option A: Core Workshop. A three-hour workshop with all participant materials for 28 supervisors."},
    {"label": "Option B: Workshop with Preparation and Follow-Up", "quote": "Option B: Workshop with Preparation and Follow-Up."},
]


def test_a_sign_off_is_not_offered_the_options_a_document_gives_its_reader():
    """12 Nov, production: "I approve this proposal to send to the client" was shown the client's two packages."""
    out = parse_options({"approval_asks": "sign_off", "question": "Which option does the client choose?", "options": _BOTH}, PROPOSAL)
    assert out.options == [] and out.question == ""
    # A reply that does not say the approval asks for a choice is read as a sign-off.
    assert parse_options({"question": "Which?", "options": _BOTH}, PROPOSAL).options == []
    assert parse_options({"approval_asks": "Choice", "options": _BOTH}, PROPOSAL).options != []


def test_an_english_sign_off_with_no_word_of_choosing_is_never_sent(client_for_app):
    for plain in [
        "I approve this proposal to send to the client.",
        "I approve this brief as an accurate comparison of the two caps.",
        "I accept this analysis and its provisional recommendation.",
        "I have reviewed the plan and agree it is ready.",
    ]:
        assert plainly_signs_off(plain), plain
    for asks in [
        "I approve this decision on the cap.",
        "I choose Option A or Option B (stating which one).",
        "I choose the recovery option.",
        "I accept this decision package as final.",  # worded with "decision": the call reads it, and says sign-off
        "Elijo la opción de recuperación.",
    ]:
        assert not plainly_signs_off(asks), asks
    http, mock = client_for_app
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this proposal to send to the client.", "stage_label": "Final proposal", "content": PROPOSAL})
    assert res.status_code == 200 and res.json() == {"question": "", "options": []}
    assert mock.generate_json.await_count == 0


def test_the_prompt_says_whose_choice_it_is_and_names_the_audience():
    system, user = build_options_prompt(_req(inputs=PMInput(**_inputs(audience="The client commissioning the workshop"))))
    assert "THE AUDIENCE (who the work is written for): The client commissioning the workshop" in user
    assert "WHOSE CHOICE IT IS" in system
    assert "a proposal offers its client two packages" in system
    assert "They are not the user's decision" in system
    assert "\"approval_asks\": \"choice\" or \"sign_off\"" in system
    assert "A sign-off has no options, whatever the text lays out." in system


def test_anything_but_an_object_gives_no_options():
    assert parse_options(None, STAGE).options == []
    assert parse_options({"options": "Option A"}, STAGE).options == []
    assert parse_options({"options": [None, "x", {"label": "", "quote": ""}]}, STAGE).options == []


def test_the_route_returns_the_traced_options_from_one_small_call(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"approval_asks": "choice", "question": "Raise the cap?", "options": [
        {"label": "Option A: $195,000 for both searches", "quote": "Option A: raise the cap to $195,000 per hire for both searches."},
        {"label": "Option B: keep $180,000", "quote": "Option B: keep the approved cap of $180,000 per hire."},
    ]}, {})
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this decision on the cap.", "stage_label": "Cap decision", "content": STAGE})
    assert res.status_code == 200
    assert [o["label"] for o in res.json()["options"]] == ["Option A: $195,000 for both searches", "Option B: keep $180,000"]
    assert mock.generate_json.await_count == 1
    assert mock.generate_json.await_args.kwargs["model"] == OPTIONS_MODEL


def test_a_failed_call_or_an_empty_stage_answers_with_none_and_never_an_error(client_for_app):
    http, mock = client_for_app
    mock.generate_json.side_effect = RuntimeError("upstream down")
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this decision.", "content": STAGE})
    assert res.status_code == 200 and res.json() == {"question": "", "options": []}
    mock.generate_json.reset_mock(side_effect=True)
    res = http.post("/api/agent/decision-options", json={"inputs": _inputs(), "approval": "I approve this.", "content": "  "})
    assert res.json()["options"] == [] and mock.generate_json.await_count == 0


def test_the_mock_offers_the_options_the_stage_text_names():
    system, user = build_options_prompt(_req())
    out = parse_options(_json_reply(system, user), STAGE)
    assert [o.label[:8] for o in out.options] == ["Option A", "Option B"]
    system, user = build_options_prompt(_req(content="# Brief\n\nThe brief is complete."))
    assert parse_options(_json_reply(system, user), "# Brief\n\nThe brief is complete.").options == []
    # A sign-off gets none, whatever its text names.
    system, user = build_options_prompt(_req(approval="I approve this proposal to send to the client.", content=PROPOSAL))
    assert parse_options(_json_reply(system, user), PROPOSAL).options == []
    system, user = build_options_prompt(_req(approval="I approve this stage."))
    assert parse_options(_json_reply(system, user), STAGE).options == []


# 22 Nov, Sean's warehouse test: Approve option v6 after Option A's training quote rose (L-274).
WAREHOUSE = (
    "# Approve an Option\n\n"
    "| | Option A | Option B |\n|---|---|---|\n"
    "| **All-in cost** (including $5,000 contingency) | $52,000 ($36,000 + $11,000 + $5,000) | $49,000 ($38,000 + $6,000 + $5,000) |\n"
    "| **Go-live, all sites** (after two-business-day pilots) | December 17 (Thursday) | December 18 (Friday) |\n"
    "| **Eligibility** (within $50,000 cap and live by December 18) | Ineligible: $2,000 over the cap ($52,000 − $50,000) "
    "| Eligible: $1,000 under the cap ($50,000 − $49,000) and live on the deadline |\n"
)
CAP = "Hard cap of $50,000 all-in, including a mandatory $5,000 contingency."
WAREHOUSE_REPLY = {"approval_asks": "choice", "question": "Which labeling option do you approve?", "options": [
    {"label": "Option A: $52,000 all-in, live December 17 (over the $50,000 cap)", "quote": "$52,000 ($36,000 + $11,000 + $5,000)",
     "fails": {"requirement": CAP, "quote": "Ineligible: $2,000 over the cap ($52,000 − $50,000)"}},
    {"label": "Option B: $49,000 all-in, live December 18", "quote": "$49,000 ($38,000 + $6,000 + $5,000)"},
]}


def test_an_option_the_text_shows_over_a_requirement_is_kept_and_marked():
    out = parse_options(WAREHOUSE_REPLY, WAREHOUSE, [CAP, "All sites must go live by December 18 after a two-business-day pilot at each site."])
    assert [o.label.split(":")[0] for o in out.options] == ["Option A", "Option B"]
    a, b = out.options
    assert a.fails is not None
    assert a.fails.requirement == CAP
    assert a.fails.quote.startswith("Ineligible: $2,000 over the cap")
    assert b.fails is None


def test_a_failure_is_dropped_when_either_passage_cannot_be_traced():
    invented = {**WAREHOUSE_REPLY, "options": [
        {**WAREHOUSE_REPLY["options"][0], "fails": {"requirement": "Spend no more than $45,000.", "quote": "Ineligible: $2,000 over the cap ($52,000 − $50,000)"}},
        {**WAREHOUSE_REPLY["options"][1], "fails": {"requirement": CAP, "quote": "Option B is over the cap by $3,000."}},
    ]}
    out = parse_options(invented, WAREHOUSE, [CAP])
    assert len(out.options) == 2
    assert all(o.fails is None for o in out.options)
    # With no requirements at all, nothing can be marked.
    assert all(o.fails is None for o in parse_options(WAREHOUSE_REPLY, WAREHOUSE).options)


def test_the_prompt_lists_the_users_requirements_and_asks_for_failures():
    req = DecisionOptionsRequest(
        inputs=PMInput(**_inputs(constraints="", facts=[
            {"statement": CAP, "kind": "requirement"},
            {"statement": "Option B: $38,000 equipment and installation, plus $6,000 training.", "kind": "fact"},
        ])),
        approval="I choose the labeling option to approve", stage_label="Approve option", content=WAREHOUSE,
    )
    system, user = build_options_prompt(req)
    assert f"REQUIREMENTS:\n- {CAP}" in user
    assert "Option B: $38,000" not in user.split("REQUIREMENTS:")[1].split("\n\n")[0]
    assert "fails" in system and "Never test an option against a requirement yourself" in system


def test_the_route_returns_the_failure(client_for_app):
    client, mock = client_for_app
    mock.generate_json.return_value = (WAREHOUSE_REPLY, {})
    body = {
        "inputs": _inputs(constraints="", facts=[{"statement": CAP, "kind": "requirement"}]),
        "approval": "I choose the labeling option to approve", "stage_label": "Approve option", "content": WAREHOUSE,
    }
    res = client.post("/api/agent/decision-options", json=body)
    assert res.status_code == 200
    options = res.json()["options"]
    assert options[0]["fails"]["requirement"] == CAP
    assert options[1]["fails"] is None
