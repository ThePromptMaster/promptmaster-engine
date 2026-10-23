"""14 Oct (Sean): a wedding speech told "do not invent memories or stories" grew
a "lifelong pattern"; a workshop time change dropped a checklist line, the
greeting and the sign-off. The prompts say both rules before the draft."""

from __future__ import annotations

import pytest

from promptmaster.conversation import _APPLY_INSTRUCTION
from promptmaster.project_context import FACT_BOUNDARY, context_block, no_invented_details
from promptmaster.schemas import AcceptedFact, PMInput as _PMInput, UserInstruction


def PMInput(**kw):  # noqa: N802 — the fields these tests do not care about
    return _PMInput(**{"audience": "Guests", "constraints": "", "output_format": "Prose", "mode": "architect", **kw})


@pytest.mark.parametrize("text", [
    "Ask me one question at a time. Don't invent memories or stories.",
    "do not invent memories or stories; keep the process simple",
    "Keep the story and joke, add no new personal details, and keep it around two minutes.",
    "Do not make up any details about the guests.",
    "Never fabricate facts.",
])
def test_the_rule_is_read_from_the_users_words(text):
    assert no_invented_details(PMInput(objective=text))


@pytest.mark.parametrize("text", [
    "Write a launch announcement for the new feature.",
    "Do not invent citations.",  # a research rule, not a personal-details one
])
def test_other_briefs_carry_no_boundary(text):
    assert not no_invented_details(PMInput(objective=text))
    assert FACT_BOUNDARY not in context_block(PMInput(objective=text))


def test_the_boundary_rides_in_every_prompts_context_when_set():
    inputs = PMInput(objective="A wedding speech.", constraints="do not invent memories or stories")
    block = context_block(inputs)
    assert FACT_BOUNDARY in block
    assert "never make a supplied event bigger than it was" in block


def test_an_applied_instruction_sets_it_too():
    inputs = PMInput(objective="A wedding speech.", user_instructions=[UserInstruction(stage="Output", version=3, instruction="Add no new personal details.")])
    assert no_invented_details(inputs)


def test_apply_keeps_what_the_chat_did_not_ask_to_change():
    assert "every line, list item, greeting, sign-off and fact the instruction does not concern is kept, word for word" in _APPLY_INSTRUCTION


def test_an_accepted_requirement_sets_it_too():
    inputs = PMInput(objective="A wedding speech.", facts=[AcceptedFact(statement="Add no new personal details.", kind="requirement")])
    assert no_invented_details(inputs)


# Client, 21 Oct ("pick your language"): the same rule, said in another language.
# `frontend/src/lib/workflow/fact-boundary.test.ts` uses the same sentences.
@pytest.mark.parametrize("text", [
    "No inventes detalles personales.",
    "N'invente pas de souvenirs ni d'anecdotes.",
    "Não invente histórias sobre os noivos.",
    "Keine Details erfinden.",
    "Non inventare dettagli sugli ospiti.",
    "Verzin geen details over de gasten.",
])
def test_the_rule_is_read_in_the_offered_languages(text):
    assert no_invented_details(PMInput(objective=text))


@pytest.mark.parametrize("text", [
    "Inventa una historia sobre un dragón.",  # no negation: asking for invention
    "No uses jerga. Inventa detalles divertidos.",  # the negation is in another sentence
])
def test_an_invitation_to_invent_is_not_the_rule(text):
    assert not no_invented_details(PMInput(objective=text))
