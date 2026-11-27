"""How much process a request needs (11 Nov): rules first, one small call, never an error."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.request_size import SIZE_MODEL, SizeRequest, at_least_standard, build_size_prompt, parse_size, several_deliverables, size_by_rule, stated_words
from promptmaster.workflow_designer import build_workflow_prompt


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def test_a_stated_length_is_read_from_the_request():
    assert stated_words("a 500-word note") == 500
    assert stated_words("about 60,000 words") == 60_000
    assert stated_words("an 80k word novel") == 80_000
    assert stated_words("a two-page memo, no more than 2 pages") == 800
    assert stated_words("revenue of $18 million") is None


def test_what_the_words_settle_is_a_rule_and_costs_no_call():
    assert size_by_rule("Write a 60,000-word book about lions").depth == "full"
    assert size_by_rule("A report in twelve chapters on the grid").depth == "full"
    # The reason reads as a sentence however the request spelt it ("12-chapter" on production, 11 Nov).
    assert size_by_rule("A complete 12-chapter operations handbook").reason == "The request asks for 12 chapters, which is long work."
    short = size_by_rule("A 300 word email to the team about Friday")
    assert short.depth == "concise" and short.by == "rule"
    # A length in between, or none, is not settled by a rule.
    assert size_by_rule("A 2,500 word proposal") is None
    assert size_by_rule("Prepare a preliminary acquisition screen of the target") is None


def test_the_prompt_judges_the_work_not_the_length_of_the_brief():
    system, user = build_size_prompt(SizeRequest(description="Screen the target. " * 900, attached_chars=12_000))
    assert "Judge the work, not how long the request is" in system
    assert "If you are unsure between two, choose the smaller" in system
    assert "DOCUMENTS ATTACHED: about 12,000 characters" in user
    assert len(user) < 6_400


def test_an_unusable_answer_is_the_usual_process():
    assert parse_size({"depth": "enormous"}).depth == "standard"
    assert parse_size(None).by == "default"
    out = parse_size({"depth": "concise", "reason": "One memo  from supplied figures."})
    assert out.depth == "concise" and out.by == "model" and out.reason == "One memo from supplied figures."


def test_the_endpoint_uses_a_small_model_and_a_rule_skips_it(client_for_app):
    client, mock = client_for_app
    mock.generate_json = AsyncMock(return_value=({"depth": "standard", "reason": "It needs analysis first."}, {}))
    res = client.post("/api/size-request", json={"description": "A market entry report for Brazil"})
    assert res.status_code == 200 and res.json()["depth"] == "standard"
    assert mock.generate_json.call_args.kwargs["model"] == SIZE_MODEL
    mock.generate_json.reset_mock()
    res = client.post("/api/size-request", json={"description": "A 200 word thank-you note"})
    assert res.json() == {"depth": "concise", "reason": "The request asks for about 200 words, which is one sitting.", "by": "rule", "outreach": False}
    mock.generate_json.assert_not_called()


def test_a_failed_call_never_stops_a_start(client_for_app):
    client, mock = client_for_app
    mock.generate_json = AsyncMock(side_effect=RuntimeError("down"))
    res = client.post("/api/size-request", json={"description": "A market entry report for Brazil"})
    assert res.status_code == 200 and res.json()["depth"] == "standard" and res.json()["by"] == "default"


def test_the_designer_scales_its_stages_to_the_depth():
    assert "Design 3 to 8 stages" in build_workflow_prompt("a memo", "Decide")[1]
    standard = build_workflow_prompt("a memo", "Decide", depth="standard")[1]
    assert "Design 3 to 5 stages" in standard and "fewest stages that do the work" in standard
    full = build_workflow_prompt("a book", "Write it", depth="full")[1]
    assert "Design 5 to 8 stages" in full


# 19 Nov, a client: "I explicitly requested the full project workflow" and got the
# one-stage view. Each request named one short piece ("a staff announcement under
# 150 words"), and the largest stated length decided the whole request.
LAUNCH = (
    "Build a full project for a fictional depot launch. Prepare a coordinated launch plan.\n\n"
    "Facts\n\nThe depot has 30 staff across two shifts.\n\n"
    "Deliverables\n\n"
    "1. An executive recommendation describing readiness and costs.\n"
    "2. A training schedule covering every shift.\n"
    "3. A budget table.\n"
    "4. A supervisor checklist.\n"
    "5. A staff announcement under 150 words."
)


def test_a_full_process_request_is_never_concise_by_one_short_piece():
    assert size_by_rule(LAUNCH) is None
    assert size_by_rule("Use the full PromptMaster project workflow. Prepare two short notices. Keep each document under 100 words.") is None
    assert size_by_rule("Build a full project for a scanner rollout: a schedule, a budget, and a staff announcement under 120 words.") is None
    # A request that is one short piece is still one sitting.
    assert size_by_rule("Write a 120-word reminder to staff to pick up their badges").depth == "concise"


def test_several_deliverables_are_read_not_ruled():
    assert several_deliverables(LAUNCH)
    assert several_deliverables("Objective\n\nDeliverables: a recommendation; a 100-word notice")
    assert several_deliverables("Prepare three short internal documents for the team")
    assert not several_deliverables("A 300 word email to the team about Friday")
    assert not several_deliverables("1. Open with thanks\n2. Mention Friday")  # an outline of one piece, not deliverables
    assert size_by_rule("Deliverables: a recommendation; a 100-word notice") is None


def test_a_reading_that_says_concise_is_raised_for_a_full_process_request(client_for_app):
    out = at_least_standard(parse_size({"depth": "concise", "reason": "Short."}), LAUNCH)
    assert out.depth == "standard" and out.reason == "The request asks for the full project workflow."
    assert at_least_standard(parse_size({"depth": "concise", "reason": "Short."}), "A thank-you note").depth == "concise"
    client, mock = client_for_app
    mock.generate_json = AsyncMock(return_value=({"depth": "concise", "reason": "One sitting."}, {}))
    res = client.post("/api/size-request", json={"description": LAUNCH})
    assert res.json()["depth"] == "standard"
    mock.generate_json.assert_called_once()


@pytest.mark.parametrize("request_text, outreach", [
    ("I have a list of 10 companies from Clay; find the right person, write a personal note to each and send", True),
    ("Here is a CSV of contacts. Draft a personalised email to each and send them after I approve", True),
    ("Email these 25 prospects about the beta", True),
    ("Write an email to my landlord about the leak", False),
    ("A memo on Q3 leads conversion", False),
    ("Write a 300-word email to all the customers about the outage", False),
])
def test_emails_to_a_list_are_never_the_one_stage_workflow(request_text, outreach):
    """26 Nov (Sean): each email is short, but the work is the list, the research, the approval and the send."""
    from promptmaster.request_size import SizeResponse, is_outreach
    assert is_outreach(request_text) is outreach
    read = at_least_standard(SizeResponse(depth="concise", reason="An email.", by="model"), request_text)
    assert (read.depth == "standard") is outreach
    if outreach:
        assert size_by_rule(request_text + " About 120 words each.") is None


def test_the_size_says_when_a_request_is_emails_to_a_list():
    stub = AsyncMock()
    stub.generate_json = AsyncMock(return_value=({"depth": "concise", "reason": "An email."}, {}))
    app.dependency_overrides[get_client] = lambda: stub
    try:
        c = TestClient(app)
        r = c.post("/api/size-request", json={"description": "I have a list of 10 companies from Clay; write a personal note to each and send"})
        assert r.json()["outreach"] is True and r.json()["depth"] == "standard"
        r = c.post("/api/size-request", json={"description": "Write an email to my landlord about the leak"})
        assert r.json()["outreach"] is False
    finally:
        app.dependency_overrides.pop(get_client, None)
