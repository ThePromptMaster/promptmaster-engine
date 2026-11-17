"""A repair rewrites only the sections its reason concerns, and nothing when it is already made (17 Nov).

Sean's book: a retitle the chapters already carried was "repaired" by rewriting all 26 sections,
twelve times, for about $63, and the text did not change.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.long_form import SECTION_UNCHANGED, build_section_revision_prompt, generate_section_prose
from promptmaster.mock_llm import _json_reply
from promptmaster.schemas import OutlineSection, PMInput, SectionRevisionBrief
from promptmaster.section_targets import (
    SECTIONS_INSTRUCTION,
    SECTIONS_MODEL,
    SectionExcerpt,
    SectionsToRepairRequest,
    SupersededPair,
    build_sections_prompt,
    parse_sections,
)

REASON = "The drafted manuscript's Chapter 5 section carries the old title, which must change to \"Beyond the Growth Narrative\"."


@pytest.fixture
def client_for_app():
    mock = AsyncMock()
    app.dependency_overrides[get_client] = lambda: mock
    yield TestClient(app), mock
    app.dependency_overrides.clear()


def _req(**over) -> SectionsToRepairRequest:
    return SectionsToRepairRequest(**{
        "reason": REASON,
        "superseded": [SupersededPair(was="$400", now="$450")],
        "sections": [
            SectionExcerpt(id="s4", title="Chapter 4: Mississippi's Reading Gains", excerpt="Mississippi's scores rose."),
            SectionExcerpt(id="s5", title="Chapter 5: Beyond the Growth Narrative", excerpt="…as \"Beyond the Growth Narrative\" argues…"),
            SectionExcerpt(id="s6", title="Chapter 6: Alabama, Louisiana", excerpt="Three states."),
        ],
        **over,
    })


def test_the_prompt_carries_the_reason_the_replaced_values_and_each_excerpt():
    system, user = build_sections_prompt(_req())
    assert system == SECTIONS_INSTRUCTION
    assert "WHY THE MANUSCRIPT WAS REOPENED: The drafted manuscript's Chapter 5" in user
    assert '- was "$400", now "$450"' in user
    assert "[s5] Chapter 5: Beyond the Growth Narrative" in user
    assert "already_done: true only when" in system
    assert "is NOT listed" in system


def test_already_made_lists_nothing_whatever_else_comes_back():
    out = parse_sections({"already_done": True, "sections": [{"id": "s5"}], "note": "The new title already heads Chapter 5."}, _req())
    assert out.checked and out.already_done and out.sections == []
    assert out.note == "The new title already heads Chapter 5."


def test_only_known_ids_each_once_in_manuscript_order():
    out = parse_sections({"sections": [{"id": "s6", "why": "b"}, {"id": "[s4]", "why": "a"}, {"id": "s99"}, "s6"]}, _req())
    assert out.checked and not out.already_done
    assert [(s.id, s.why) for s in out.sections] == [("s4", "a"), ("s6", "b")]


def test_no_answer_is_not_checked():
    assert parse_sections("nonsense", _req()).checked is False


def test_the_route_makes_one_small_call_and_a_failure_is_not_checked(client_for_app):
    http, mock = client_for_app
    mock.generate_json.return_value = ({"already_done": False, "sections": [{"id": "s5", "why": "It names the chapter."}]}, {})
    body = _req().model_dump()
    res = http.post("/api/agent/sections-to-repair", json=body)
    assert res.status_code == 200
    assert res.json()["checked"] is True
    assert [s["id"] for s in res.json()["sections"]] == ["s5"]
    assert mock.generate_json.await_args.kwargs["model"] == SECTIONS_MODEL

    mock.generate_json.side_effect = RuntimeError("down")
    res = http.post("/api/agent/sections-to-repair", json=body)
    assert res.status_code == 200
    assert res.json() == {"checked": False, "already_done": False, "sections": [], "note": ""}


def test_the_mock_lists_every_section_it_is_sent():
    system, user = build_sections_prompt(_req())
    assert [s["id"] for s in _json_reply(system, user)["sections"]] == ["s4", "s5", "s6"]


# A rewrite that does not concern a section says so instead of writing it out again.

INPUTS = PMInput(objective="A short guide.", mode="architect")
OUTLINE = [OutlineSection(id="a", title="One", abstract="The first part.")]


def test_a_rewrite_is_told_to_answer_unchanged_rather_than_copy_the_section():
    _system, user = build_section_revision_prompt(INPUTS, OUTLINE, 0, SectionRevisionBrief(current_content="Old text."))
    assert f"reply with exactly {SECTION_UNCHANGED} and nothing else" in user


@pytest.mark.asyncio
async def test_an_unchanged_reply_hands_back_the_section_as_it_was():
    client = AsyncMock()
    client.generate_with_meta.return_value = ("SECTION UNCHANGED.", {}, "stop")
    out = await generate_section_prose(client, None, INPUTS, OUTLINE, 0, revision=SectionRevisionBrief(current_content="Old text, kept."))
    assert out.unchanged is True
    assert out.content == "Old text, kept."


@pytest.mark.asyncio
async def test_a_first_draft_never_reads_the_marker():
    client = AsyncMock()
    client.generate_with_meta.return_value = ("SECTION UNCHANGED", {}, "stop")
    out = await generate_section_prose(client, None, INPUTS, OUTLINE, 0)
    assert out.unchanged is False
