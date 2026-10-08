"""Later stages read the earlier stages' saved documents, not summaries (8 Oct).

A consistency check reported "no mobile app" missing from an FAQ that said it,
and later said the full saved FAQ was not present for verification: it had
been given a 320-character summary. These assert that the full text sent by
the client reaches both the generation and the check prompt.
"""

from __future__ import annotations

from promptmaster.schemas import StageDescriptor, StageDigest, StageDigestEntry
from promptmaster.stage import build_stage_prompt
from promptmaster.stage_evaluation import build_stage_evaluation_prompt
from promptmaster.saved_documents import DOCUMENTS_RULE

FAQ = "\n".join(
    [
        "Q1. When does TeamNotes launch? A. November 12, 2026.",
        "Q2. Is there a mobile app? A. No — there is no mobile app at launch.",
        "Q3. Is there a free trial? A. No free trial is offered.",
        "Q4. How do I use it? A. Through a web browser.",
        "Q5. What does it cost? A. $12 per user per month.",
    ]
)

DIGEST = StageDigest(
    objective="Announce TeamNotes and answer five questions.",
    prior_stages=[
        StageDigestEntry(stage_id="facts", label="Confirm facts", summary="Launch Nov 12; $12."),
        StageDigestEntry(stage_id="faq", label="Support FAQ", summary="Five questions…", text=FAQ, version=2),
    ],
)

CHECK = StageDescriptor(id="consistency", label="Check consistency", renderer="review", entry_prompt_hint="Compare the documents.")


def test_the_check_prompt_carries_the_whole_saved_faq(basic_inputs):
    _system, user = build_stage_evaluation_prompt(basic_inputs, CHECK, "{}", DIGEST)
    assert "there is no mobile app at launch" in user
    assert "Through a web browser" in user
    assert "### Support FAQ — v2" in user
    assert DOCUMENTS_RULE in user


def test_generation_reads_the_same_documents(basic_inputs):
    _system, user = build_stage_prompt(basic_inputs, CHECK, DIGEST)
    assert "No free trial is offered" in user
    # A stage sent without text keeps its one-line summary.
    assert "- Confirm facts: Launch Nov 12; $12." in user


def test_a_cut_document_says_so(basic_inputs):
    cut = StageDigest(prior_stages=[StageDigestEntry(stage_id="faq", label="FAQ", text="Q1…", truncated=True)])
    _system, user = build_stage_evaluation_prompt(basic_inputs, CHECK, "{}", cut)
    assert "(cut to fit; the rest is not shown)" in user
