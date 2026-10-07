"""Accepted facts, recorded once and read by every stage, check and chat
(F1/F2, 7 Oct). Sean, 6 Oct, email 4: "the final check classified those same
figures as unsupported because they did not appear in the supplied candidate
facts"; email 7: "How every stage retrieves the same current information."

One formatter (`project_context.facts_block`), carried by `context_block`, so
the prompts cannot disagree about what the facts are. This holds it in place
across the prompts that produce, check and discuss the work.
"""

from __future__ import annotations

from promptmaster.conversation import build_chat_reply_prompt
from promptmaster.criterion_check import build_check_prompt
from promptmaster.objective_assessment import build_assessment_prompt
from promptmaster.project_context import FACTS_HEADER, context_block, facts_block
from promptmaster.reply_actions import build_reply_actions_prompt, parse_reply_actions
from promptmaster.schemas import AcceptedFact, PMInput, StageDescriptor, StageDigest
from promptmaster.stage import build_stage_prompt
from promptmaster.stage_evaluation import build_stage_evaluation_prompt

FACT = AcceptedFact(statement="Candidate A has managed 100 or more employees for 7 years", subject="Candidate A",
                    source="from the side chat, 6 Oct")
REQ = AcceptedFact(statement="At least one researcher stays available for client commitments", kind="requirement",
                   source="added to the brief, 6 Oct")
LINE = "- Fact (Candidate A): Candidate A has managed 100 or more employees for 7 years — from the side chat, 6 Oct"


def _inputs(**kw) -> PMInput:
    return PMInput(objective="Choose the strongest finalist", audience="Board", mode="analyst", facts=[FACT, REQ], **kw)


def test_the_block_names_each_fact_its_source_and_says_it_is_authoritative():
    block = facts_block(_inputs())
    assert block.startswith(FACTS_HEADER)
    assert LINE in block
    assert "- Requirement: At least one researcher stays available" in block
    assert "never call one unsupported or suggest removing it" in block
    # Carried with the context, and on its own when there is no context.
    assert context_block(_inputs()) == block
    assert context_block(_inputs(context="Board pack.")).startswith(block)
    assert facts_block(PMInput(objective="x", mode="analyst")) == ""


def test_every_prompt_that_makes_checks_or_discusses_the_work_reads_the_same_facts(basic_iteration):
    stage = StageDescriptor(id="final", label="Final check", renderer="review")
    prompts = {
        "stage": "\n".join(build_stage_prompt(_inputs(), stage, StageDigest(objective="o"))),
        "stage check": "\n".join(build_stage_evaluation_prompt(_inputs(), stage, "Recommend A.", StageDigest())),
        "chat": "\n".join(build_chat_reply_prompt(_inputs(), basic_iteration, [], "Why A?", [])),
        "chat actions": "\n".join(build_reply_actions_prompt(_inputs(), "Final", "Why A?", "Because…", None)),
        "routine approval check": "\n".join(build_check_prompt(_inputs(), "Final", "It is checked", "Text")),
        "objective check": "\n".join(build_assessment_prompt(_inputs(), "Final", "Text", [])),
    }
    for name, text in prompts.items():
        assert LINE in text, f"{name} does not carry the accepted facts"


def test_chat_offers_to_record_only_facts_the_user_wrote():
    question = "Candidate A has managed 100 or more employees for 7 years. Candidate B for 4 years. Update the facts."
    raw = {"actions": [{"label": "Record these facts", "kind": "record_facts", "facts": [
        {"statement": "Candidate A has managed 100 or more employees for 7 years", "subject": "Candidate A"},
        {"statement": "Candidate B has managed 100 or more employees for 4 years", "kind": "fact"},
        # The model's own figure, not the user's: dropped.
        {"statement": "Candidate C has managed 100 or more employees for 12 years"},
        {"statement": "Keep one researcher free", "kind": "requirement"},
    ]}]}
    [action] = parse_reply_actions(raw, None, question)
    assert action.kind == "record_facts"
    assert [f.statement for f in action.facts] == [
        "Candidate A has managed 100 or more employees for 7 years",
        "Candidate B has managed 100 or more employees for 4 years",
    ]
    # Nothing the user wrote: nothing to record, so no action.
    assert parse_reply_actions(raw, None, "What do you think?") == []


def test_the_chat_action_prompt_offers_record_facts():
    system, _ = build_reply_actions_prompt(_inputs(), "Final", "q", "a", None)
    assert '"record_facts"' in system and "Only what the user wrote" in system
