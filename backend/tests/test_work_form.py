"""The form of the work, and a fact-check that knows fiction (13 Oct, Sean's screenplay)."""

from __future__ import annotations

from promptmaster.schemas import PMInput, StageDescriptor, StageDigest
from promptmaster.stage import _claim_provenance, build_stage_prompt
from promptmaster.work_form import FICTION_CLAIMS_RULE, form_block, form_of


def _inputs(objective: str, output_format: str = "") -> PMInput:
    return PMInput(objective=objective, audience="General", mode="architect", output_format=output_format)


SCREENPLAY = _inputs(
    "I want to write a screenplay about the French revolution: a political thriller with a fictional outsider near power",
    "A feature-length screenplay",
)
FACT_CHECK = StageDescriptor(
    id="fact_check", label="Fact-checking and citation review", renderer="review",
    entry_prompt_hint="Extract the factual claims the draft actually makes.", artifact_kind="claim_table",
)


def test_reads_the_form_from_the_brief():
    assert form_of(SCREENPLAY).key == "screenplay"
    assert form_of(_inputs("A three-act stage play about a lighthouse")).key == "play"
    assert form_of(_inputs("A novel set in 1920s Lisbon")).key == "novel"
    assert form_of(_inputs("A practical book on bookkeeping for small charities")) is None
    assert form_of(_inputs("A non-fiction book about tides")) is None
    assert form_of(_inputs("Nonfiction: a history of tides")) is None


def test_every_prompt_is_told_the_form_and_the_words():
    block = form_block(SCREENPLAY)
    assert "THE FORM OF THE WORK: a screenplay" in block
    assert "wherever they say chapter, read sequence" in block
    assert "scene headings (INT./EXT." in block
    system, user = build_stage_prompt(SCREENPLAY, FACT_CHECK, StageDigest(manuscript="INT. CAFE — NIGHT\nAdrien waits."))
    assert "THE FORM OF THE WORK: a screenplay" in system
    assert "THE SCREENPLAY AS DRAFTED — the actual sequences" in user
    assert "the actual chapters" not in user
    assert form_block(_inputs("A practical book on bookkeeping")) == ""


def test_a_fiction_fact_check_sorts_story_from_world():
    system, _ = build_stage_prompt(SCREENPLAY, FACT_CHECK, StageDigest())
    assert FICTION_CLAIMS_RULE in system
    assert "Invented characters, scenes, documents" in system
    assert "If he sees… / If he does not see" in system
    nonfiction, _ = build_stage_prompt(_inputs("A history of the Committee of Public Safety"), FACT_CHECK, StageDigest())
    assert FICTION_CLAIMS_RULE not in nonfiction


def test_fiction_is_a_decision_the_extraction_may_make():
    assert _claim_provenance({"status": "fiction", "source": "none found", "reason": "Invented"}) == {"status": "fiction"}
    assert _claim_provenance({"status": "verified", "source": "none"}) == {"status": "no_source"}
