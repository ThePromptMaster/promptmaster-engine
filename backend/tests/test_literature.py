"""Literature lookup (1 Oct feedback, item 12): matching is pure and tested without a network."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from promptmaster.literature import WorkQuery, best_match, offered, search_text, title_of, title_overlap, to_match

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


def test_a_single_quoted_title_keeps_its_apostrophes():
    """Production, 2026-10-01: "'Software Developers' Perceptions of Productivity.'" was searched as "Software Developers"."""
    assert title_of("Meyer, A. N. (2019). 'Software Developers' Perceptions of Productivity.' FSE.") == "Software Developers' Perceptions of Productivity"
    assert title_of("Haraldsson, G. (2021). 'Going Public: Iceland's journey to a shorter working week.' Autonomy.") == (
        "Going Public: Iceland's journey to a shorter working week"
    )
    assert title_of("Pencavel, J. (2015). 'The Productivity of Working Hours.' Economic Journal.") == "The Productivity of Working Hours"


def test_what_is_sent_to_the_index_has_no_characters_it_rejects():
    """Production, 2026-10-01: a question mark in a title was a 400, reported as "could not be reached"."""
    assert search_text("Does Working from Home Work? Evidence from a Chinese Experiment") == "Does Working from Home Work Evidence from a Chinese Experiment"
    assert search_text("Software Developers' Perceptions (of Productivity)") == "Software Developers Perceptions of Productivity"


# --- searching by topic (2 Oct): no work is named yet ------------------------

def test_a_topic_search_offers_records_as_the_index_holds_them():
    [work] = offered([ASCARZA], 8)
    assert work.found
    assert work.id == "https://openalex.org/W1"
    assert work.title == ASCARZA["display_name"]
    assert (work.authors, work.year, work.doi) == ("Eva Ascarza", 2018, "https://doi.org/10.1509/jmr.16.0163")


def test_a_topic_search_drops_fragments_and_repeats_and_stops_at_the_limit():
    fragment = {"id": "W2", "display_name": "Customer Churn"}
    untitled = {"id": "W3", "display_name": None}
    preprint = {**ASCARZA, "id": "https://openalex.org/W4", "doi": None}
    other = {"id": "W5", "display_name": "Customer switching behavior in service industries", "publication_year": 1995}
    assert [w.id for w in offered([fragment, untitled, ASCARZA, preprint, other], 8)] == ["https://openalex.org/W1", "W5"]
    assert len(offered([ASCARZA, other], 1)) == 1


def test_the_search_route_in_mock_mode_never_touches_the_network(monkeypatch):
    monkeypatch.setenv("PM_LLM_MODE", "mock")
    res = TestClient(app).post("/api/agent/literature-search", json={"query": "customer churn"})
    assert res.status_code == 200
    body = res.json()
    assert (body["source"], body["reached"]) == ("OpenAlex", True)
    assert [w["title"] for w in body["works"]] == [f"Mock found work {n} on the topic" for n in (1, 2, 3)]
    assert all(w["found"] and w["doi"].startswith("https://doi.org/") for w in body["works"])


def test_the_search_route_refuses_an_empty_query_and_too_many_results(monkeypatch):
    monkeypatch.setenv("PM_LLM_MODE", "mock")
    client = TestClient(app)
    assert client.post("/api/agent/literature-search", json={"query": ""}).status_code == 422
    assert client.post("/api/agent/literature-search", json={"query": "churn", "limit": 50}).status_code == 422
