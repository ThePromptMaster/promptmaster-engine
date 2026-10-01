"""Literature lookup (1 Oct feedback, item 12): matching is pure and tested without a network."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from promptmaster.literature import WorkQuery, best_match, title_of, title_overlap, to_match

ASCARZA = {
    "id": "https://openalex.org/W1", "doi": "https://doi.org/10.1509/jmr.16.0163",
    "display_name": "Retention Futility: Targeting High-Risk Customers Might be Ineffective",
    "publication_year": 2018,
    "authorships": [{"author": {"display_name": "Eva Ascarza"}}],
}
NAMED = "Ascarza, Eva (2018), “Retention Futility: Targeting High-Risk Customers Might Be Ineffective,” Journal of Marketing Research"


def test_a_record_whose_title_is_in_the_named_work_matches():
    assert title_overlap(NAMED, ASCARZA["display_name"]) == 1.0
    match = to_match(WorkQuery(id="i1", work=NAMED), best_match(NAMED, [ASCARZA]))
    assert match.found
    assert match.doi == "https://doi.org/10.1509/jmr.16.0163"
    assert match.authors == "Eva Ascarza"
    assert match.year == 2018


def test_a_record_on_the_same_topic_with_a_different_title_does_not_match():
    other = {**ASCARZA, "display_name": "Customer Retention Strategies in Subscription Businesses: A Review"}
    assert best_match(NAMED, [other]) is None
    assert not to_match(WorkQuery(id="i1", work=NAMED), None).found


def test_a_different_year_is_a_different_work():
    later = {**ASCARZA, "publication_year": 2023}
    assert best_match(NAMED, [later]) is None
    # A year either side is the usual online-first / print difference.
    assert best_match(NAMED, [{**ASCARZA, "publication_year": 2017}]) is not None


def test_a_two_word_title_is_too_little_to_call_a_match():
    assert best_match("Smith (2010) Customer Churn and other essays", [{"display_name": "Customer Churn", "publication_year": 2010}]) is None


def test_the_first_real_match_wins_over_an_earlier_near_miss():
    near = {"display_name": "Retention in Telecom: High-Risk Segments", "publication_year": 2018}
    assert best_match(NAMED, [near, ASCARZA]) is ASCARZA


def test_the_route_in_mock_mode_never_touches_the_network(monkeypatch):
    monkeypatch.setenv("PM_LLM_MODE", "mock")
    res = TestClient(app).post("/api/agent/literature", json={"works": [
        {"id": "a", "work": "Mock work 1"}, {"id": "b", "work": "Mock work 2"},
    ]})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "OpenAlex"
    assert [(m["id"], m["found"]) for m in body["matches"]] == [("a", True), ("b", False)]
    assert body["matches"][0]["doi"].startswith("https://doi.org/")
    assert body["matches"][1]["note"] == "No record with this title was found."


def test_the_title_is_what_gets_searched_not_the_whole_citation():
    """A whole citation searched as one string found none of four real papers (tried 2026-10-01)."""
    assert title_of(NAMED) == "Retention Futility: Targeting High-Risk Customers Might Be Ineffective"
    assert title_of("Keaveney, S. M. (1995). Customer switching behavior in service industries: An exploratory study. Journal of Marketing, 59(2).") == (
        "Customer switching behavior in service industries: An exploratory study"
    )
    assert title_of("The Mythical Man-Month") == "The Mythical Man-Month"
