"""FR-06 continuity records, and the bounded-context property they exist for.

The single most important assertion in this file is
`test_section_prompt_size_is_flat_across_ten_sections`. Everything else in the
drafting stack can be re-derived or retried; a prompt that grows with the prose
already written is the one failure mode that cannot be worked around, because it
ends with a document that simply cannot be continued. That test is the proof the
~100-page ceiling is gone, and it is why the records exist at all.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from promptmaster.long_form import (
    _MAX_GLOSSARY_TERMS,
    build_section_prompt,
    build_section_record_prompt,
    extract_section_record,
)
from promptmaster.schemas import GlossaryTerm, OutlineSection, SectionRecord


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _outline(n: int = 10) -> list[OutlineSection]:
    return [
        OutlineSection(id=f"s{i}", title=f"Section {i}", abstract=f"Covers topic {i}.")
        for i in range(n)
    ]


def _record(index: int, terms: int = 3) -> SectionRecord:
    """A record of realistic size: a real section leaves behind roughly this much."""
    return SectionRecord(
        section_id=f"s{index}",
        section_index=index,
        title=f"Section {index}",
        summary=(
            f"Section {index} developed the argument at length, working through "
            f"the material introduced earlier and setting up what follows. " * 2
        ),
        glossary_terms=[
            GlossaryTerm(term=f"term-{index}-{t}", definition=f"A definition for term {t} of section {index}.")
            for t in range(terms)
        ],
        decisions=[f"Section {index} committed to approach {index}."],
        todos=[f"Section {index} promised to revisit topic {index} later."],
    )


# ---------------------------------------------------------------------------
# The bounded-context property
# ---------------------------------------------------------------------------

def _prompt_size_at(basic_inputs, index: int, outline_len: int) -> int:
    """Size of the user prompt for section `index`, with every prior section written.

    Each prior section is 20k characters of prose and leaves a full record
    behind, so this is the pessimistic case, not a toy one.
    """
    outline = _outline(outline_len)
    long_prose = "This is a paragraph of generated prose. " * 500  # ~20k chars
    for i in range(index):
        outline[i].status = "complete"
        outline[i].content = long_prose

    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=outline,
        section_index=index,
        prior_snapshot=None,
        prev_section_content=long_prose if index else "",
        records=[_record(i) for i in range(index)],
    )
    return len(user)


def test_section_prompt_size_is_flat_across_ten_sections(basic_inputs):
    """Sections 1..10 of a ten-section document sit in one narrow band.

    This is the FR-05/FR-06 measurement. The document behind section 10 is
    ~180k characters of prose carrying 27 glossary terms, nine decisions and
    nine TODOs. Under the old rolling snapshot every one of those grew the
    input; here the prompt for section 10 is within a small constant of the
    prompt for section 1, and none of the prose is in it.

    Section 0 is excluded from the band because it genuinely has no prior
    context to carry — it is the floor, not part of the trend.
    """
    sizes = [_prompt_size_at(basic_inputs, i, 10) for i in range(1, 10)]
    assert max(sizes) < 2 * min(sizes), f"prompt is not bounded: {sizes}"


def test_section_prompt_size_stops_growing_entirely(basic_inputs):
    """The real property: size saturates, it does not creep.

    A ten-section band could still be a slow linear climb. This pins the
    difference: across sections 12 to 200 of the same document — roughly four
    million characters of prose written by the end — the prompt size moves by a
    couple of hundred characters, and that residue is digit widths in section
    labels ("Section 9" versus "Section 200"), not accumulated context.

    Bounded by an absolute constant rather than a ratio, deliberately. A ratio
    would still pass if the prompt were creeping proportionally; this cannot.
    """
    outline_len = 201
    sizes = {n: _prompt_size_at(basic_inputs, n, outline_len) for n in (12, 40, 80, 120, 200)}
    spread = max(sizes.values()) - min(sizes.values())
    assert spread < 500, f"prompt size is still accumulating: {sizes}"


def test_section_prompt_does_not_embed_completed_prose(basic_inputs):
    """Only the immediately previous section appears, and only its tail."""
    outline = _outline(5)
    for i in range(4):
        outline[i].status = "complete"
        outline[i].content = f"UNIQUE-PROSE-MARKER-{i} " + ("filler " * 50)

    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=outline,
        section_index=4,
        prior_snapshot=None,
        prev_section_content=outline[3].content,
        records=[_record(i) for i in range(4)],
    )
    # Section 3 is the previous one and is short enough to survive whole.
    assert "UNIQUE-PROSE-MARKER-3" in user
    # Sections 0-2 must not be in the prompt at all.
    for i in range(3):
        assert f"UNIQUE-PROSE-MARKER-{i}" not in user


def test_previous_section_is_truncated_to_its_tail(basic_inputs):
    outline = _outline(2)
    prev = "START-OF-PREVIOUS " + ("x" * 40_000) + " END-OF-PREVIOUS"

    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=outline,
        section_index=1,
        prior_snapshot=None,
        prev_section_content=prev,
    )
    assert "END-OF-PREVIOUS" in user
    assert "START-OF-PREVIOUS" not in user
    assert "earlier text omitted" in user


def test_glossary_is_capped_and_prefers_recent_terms(basic_inputs):
    """A 40-section document must not carry 120 glossary terms into the prompt."""
    records = [_record(i, terms=3) for i in range(40)]
    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=_outline(41),
        section_index=40,
        prior_snapshot=None,
        prev_section_content="",
        records=records,
    )
    present = [f"term-{i}-0" for i in range(40) if f"term-{i}-0" in user]
    assert len(present) <= _MAX_GLOSSARY_TERMS
    # Newest wins: the term from section 39 survives, the one from section 0 does not.
    assert "term-39-0" in user
    assert "term-0-0" not in user


# ---------------------------------------------------------------------------
# Record content reaches the prompt
# ---------------------------------------------------------------------------

def test_records_reach_the_section_prompt(basic_inputs):
    record = SectionRecord(
        section_id="s0",
        section_index=0,
        title="Foundations",
        summary="Established the vocabulary.",
        glossary_terms=[GlossaryTerm(term="continuity record", definition="What a section leaves behind.")],
        decisions=["Write in the second person."],
        todos=["Return to the cost model in a later section."],
    )
    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=_outline(3),
        section_index=1,
        prior_snapshot=None,
        prev_section_content="",
        records=[record],
    )
    assert "Established the vocabulary." in user
    assert "continuity record" in user
    assert "Write in the second person." in user
    assert "Return to the cost model in a later section." in user


def test_records_take_precedence_over_snapshot(basic_inputs):
    from promptmaster.schemas import ContinuitySnapshot

    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=_outline(3),
        section_index=1,
        prior_snapshot=ContinuitySnapshot(key_definitions=["SNAPSHOT-ONLY-TERM"]),
        prev_section_content="",
        records=[_record(0)],
    )
    assert "SNAPSHOT-ONLY-TERM" not in user
    assert "term-0-0" in user


def test_snapshot_path_now_includes_current_topic(basic_inputs):
    """current_topic was generated, stored and silently discarded before this."""
    from promptmaster.schemas import ContinuitySnapshot

    _system, user = build_section_prompt(
        inputs=basic_inputs,
        outline=_outline(2),
        section_index=1,
        prior_snapshot=ContinuitySnapshot(current_topic="halfway through the cost model"),
        prev_section_content="",
    )
    assert "halfway through the cost model" in user


# ---------------------------------------------------------------------------
# Extraction: one section in, one record out
# ---------------------------------------------------------------------------

def test_record_prompt_carries_only_one_section_and_term_names():
    system, user = build_section_record_prompt(
        section_title="Foundations",
        section_content="THE-SECTION-BODY",
        existing_terms=["alpha", "beta"],
    )
    assert "THE-SECTION-BODY" in user
    assert "alpha, beta" in user
    assert "JSON" in system


async def test_extract_section_record_parses_all_four_fields():
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {
            "summary": "It laid the groundwork.",
            "glossary_terms": [{"term": "drain", "definition": "The worker loop."}],
            "decisions": ["Job-based from the start."],
            "todos": ["Cover cancellation later."],
        },
        {},
    ))
    record = await extract_section_record(
        client=client, model=None, section_id="s3", section_index=3,
        section_title="Jobs", section_content="body", existing_terms=[],
    )
    assert record.summary == "It laid the groundwork."
    assert record.glossary_terms[0].term == "drain"
    assert record.glossary_terms[0].first_seen_section_id == "s3"
    assert record.decisions == ["Job-based from the start."]
    assert record.todos == ["Cover cancellation later."]


async def test_extract_section_record_skips_malformed_rows():
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(
        {
            "summary": "ok",
            "glossary_terms": ["not a dict", {"definition": "no term key"}, {"term": "  "}, {"term": "good"}],
            "decisions": "not a list",
            "todos": [None, "keep me"],
        },
        {},
    ))
    record = await extract_section_record(
        client=client, model=None, section_id="s1", section_index=1,
        section_title="T", section_content="body", existing_terms=[],
    )
    assert [t.term for t in record.glossary_terms] == ["good"]
    assert record.decisions == []
    assert record.todos == ["keep me"]


async def test_extract_section_record_survives_llm_failure():
    """A lost record degrades continuity. It must never cost the prose."""
    client = AsyncMock()
    client.generate_json = AsyncMock(side_effect=Exception("LLM down"))
    record = await extract_section_record(
        client=client, model=None, section_id="s2", section_index=2,
        section_title="Title", section_content="body", existing_terms=[],
    )
    assert record.section_id == "s2"
    assert record.summary == ""


async def test_extract_section_record_reraises_deadline():
    """A deadline means 're-queue me', not 'this section is broken'."""
    from promptmaster.llm_client import OpenRouterDeadlineError

    client = AsyncMock()
    client.generate_json = AsyncMock(side_effect=OpenRouterDeadlineError("out of budget"))
    with pytest.raises(OpenRouterDeadlineError):
        await extract_section_record(
            client=client, model=None, section_id="s2", section_index=2,
            section_title="T", section_content="body", existing_terms=[],
        )


# ---------------------------------------------------------------------------
# Prose generation, standing alone
# ---------------------------------------------------------------------------

async def test_generate_section_prose_makes_exactly_one_call(basic_inputs):
    from promptmaster.long_form import generate_section_prose

    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("Body prose.", {}, "stop"))
    client.generate_json = AsyncMock(side_effect=AssertionError("prose must not extract"))

    result = await generate_section_prose(
        client=client, model=None, inputs=basic_inputs,
        outline=_outline(3), section_index=1,
    )
    assert result.content == "Body prose."
    assert result.finish_reason == "stop"
    assert client.generate_with_meta.await_count == 1
