"""Rules a project's folders hand down (Sean, 23 Nov, "Inheritance & exceptions").

"Workspace: Propeller-wide facts and requirements ... Client folder: agreements,
contacts, and requirements that carry across searches ... Search folder: the
position spec ... Someone reviewing a transcript should get the relevant context
from the levels above." The browser resolves what is in force and sends it with
the project's own facts; the prompt says where each came from, which are
required, and what a replacement replaces here.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from promptmaster.project_context import FOLDER_RULES_RULE, SUPPLIED_RULE, context_block, facts_block
from promptmaster.schemas import AcceptedFact, PMInput

OWN = AcceptedFact(statement="Budget is $40,000.", source="added to the brief, 24 Nov")
CLIENT = AcceptedFact(
    statement="The client handles reference checks.", kind="requirement",
    source='from the client folder "Acme", 24 Nov', scope='the client folder "Acme"',
)
REQUIRED = AcceptedFact(
    statement="Reports go to the client as PDF.", kind="requirement", required=True,
    source='from the client folder "Acme", 24 Nov', scope='the client folder "Acme"',
)
REPLACEMENT = AcceptedFact(
    statement="We handle reference checks on this search.", kind="requirement",
    source='from the search folder "CFO", 24 Nov', scope='the search folder "CFO"',
    replaces_default='The client handles reference checks. (the default of the client folder "Acme")',
)


def _inputs(*facts: AcceptedFact) -> PMInput:
    return PMInput(objective="Review the CFO interview", audience="Consultants", mode="analyst", facts=list(facts))


def test_a_folder_rule_names_its_folder_and_the_rule_for_folder_rules_rides_with_it():
    block = facts_block(_inputs(OWN, CLIENT))
    assert '- Requirement: The client handles reference checks. — from the client folder "Acme", 24 Nov' in block
    assert FOLDER_RULES_RULE in block
    assert "follow the rule and say plainly what disagrees" in block


def test_no_folder_rule_no_folder_wording():
    assert FOLDER_RULES_RULE not in facts_block(_inputs(OWN))


def test_a_required_rule_is_said_to_hold_unless_an_exception_is_recorded():
    block = facts_block(_inputs(REQUIRED))
    assert "Reports go to the client as PDF." in block
    assert "(a required rule: it holds here unless an exception recorded for this project says otherwise)" in block


def test_a_replacement_names_the_default_it_replaces_and_where_it_still_holds():
    block = facts_block(_inputs(REPLACEMENT))
    assert (
        'We handle reference checks on this search. — from the search folder "CFO", 24 Nov (replaces here '
        '"The client handles reference checks. (the default of the client folder "Acme")", which still holds '
        "elsewhere but not for this project)"
    ) in block


def test_every_prompt_built_on_the_context_carries_them_with_the_supplied_rule():
    block = context_block(_inputs(OWN, CLIENT))
    assert "The client handles reference checks." in block
    assert SUPPLIED_RULE in block


def test_a_request_may_carry_the_project_facts_and_the_folder_rules_together():
    _inputs(*([OWN] * 200 + [CLIENT] * 100))
    with pytest.raises(ValidationError):
        _inputs(*([OWN] * 301))
