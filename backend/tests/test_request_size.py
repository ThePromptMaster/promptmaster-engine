"""How much process a request needs (11 Nov): rules first, one small call, never an error."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.request_size import SIZE_MODEL, SizeRequest, build_size_prompt, parse_size, size_by_rule, stated_words
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
    assert res.json() == {"depth": "concise", "reason": "The request asks for about 200 words, which is one sitting.", "by": "rule"}
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
