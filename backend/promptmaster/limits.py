"""FR-18: generation-size caps, declared once.

`routers/long_form.py` had `suggested_section_count: int = 8` with no upper
bound, so a request for five hundred sections was a well-formed request. It
would have been accepted, enqueued, and drained one paid LLM call at a time
until the OpenRouter account was empty — and the first sign of it would have
been a declined card.

Every constant here exists because some field could otherwise carry an
unbounded value into a loop or into a prompt. They are applied as Pydantic
`Field` constraints on the request models, which matters for two reasons:

**Enforcement happens at the edge.** FastAPI validates before the handler runs,
so an oversized request costs one 422 and zero LLM calls. A check inside a
router runs after the body is parsed and, historically, after two of the seven
routers forgot to write it.

**The bound is declared where the field is.** A reader of `PMInput` can see what
`objective` may contain without going to find a validator. Numbers that live in
one module and are enforced in another drift; these are imported by name.

The values are sized for a controlled beta and are deliberately generous —
roughly an order of magnitude above observed legitimate use. A cap that trips on
real work teaches people to route around it, and a cap set at exactly the
expected maximum is a cap that will trip.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Free text carried into prompts
# ---------------------------------------------------------------------------

#: The objective is one to a few paragraphs. 8k characters is a long brief.
MAX_OBJECTIVE_CHARS = 8_000
#: Constraints, format and audience are short qualifiers, not documents.
MAX_SHORT_TEXT_CHARS = 4_000
#: A custom persona preamble is a system prompt, so it gets more room.
MAX_PREAMBLE_CHARS = 8_000

#: Session facts are pinned one-liners injected into *every* prompt, so their
#: cost is multiplied by the length of the session. Bounded on both axes.
MAX_SESSION_FACTS = 50
MAX_SESSION_FACT_CHARS = 1_000

# ---------------------------------------------------------------------------
# Document-scale content
# ---------------------------------------------------------------------------

#: One section of prose, or one stage artifact. Well above what a model will
#: emit in a single call at our max_tokens.
MAX_CONTENT_CHARS = 400_000
#: A whole merged long-form document, at finalize time.
MAX_DOCUMENT_CHARS = 1_000_000

# ---------------------------------------------------------------------------
# Fan-out — the counts that multiply into LLM calls
# ---------------------------------------------------------------------------

#: The one that motivated this module. Forty sections is a long book by the
#: standards of anything this tool has drafted; five hundred is an accident.
MAX_SECTION_COUNT = 40
MIN_SECTION_COUNT = 1

#: An outline may legitimately be revised to more sections than were first
#: suggested, so the list bound is looser than the request bound — but bounded.
MAX_OUTLINE_SECTIONS = 100

#: History replayed into a prompt. Past this the context window is the binding
#: constraint anyway, and truncation is the caller's job.
MAX_ITERATION_HISTORY = 100
MAX_CHAT_HISTORY = 200
MAX_SECTION_RECORDS = 200
MAX_GLOSSARY_TERMS = 2_000
MAX_FINDINGS = 100

# ---------------------------------------------------------------------------
# Model identifiers
# ---------------------------------------------------------------------------

#: A model slug is `vendor/name:variant`. This is a sanity bound, not a
#: validation of the slug — OpenRouter decides what is a real model.
MAX_MODEL_SLUG_CHARS = 200


# ---------------------------------------------------------------------------
# Pre-flight estimation — FR-18's "large jobs can trigger a warning"
# ---------------------------------------------------------------------------

#: Rough tokens produced per drafted section, from observed runs. Used only to
#: decide whether to *warn*, never to bill, so a coarse figure is the right
#: level of precision — and pretending otherwise with a per-model estimate
#: would imply an accuracy this cannot have.
EST_TOKENS_OUT_PER_SECTION = 1_400
#: Each section's prompt carries the outline, the running records, and the tail
#: of the previous section, so input grows with the document rather than being
#: constant.
EST_TOKENS_IN_BASE = 1_200
EST_TOKENS_IN_PER_PRIOR_SECTION = 120

#: Two calls per section: prose, then the FR-06 record extraction.
CALLS_PER_SECTION = 2

#: Above this many sections, the client asks before spending. Chosen to sit
#: above a normal chapter-length run and below the point where a mistake is
#: expensive.
LARGE_JOB_SECTION_THRESHOLD = 12


def estimate_long_form_tokens(section_count: int) -> tuple[int, int]:
    """`(tokens_in, tokens_out)` for drafting `section_count` sections.

    Pure arithmetic — no LLM call, no network. A warning that costs a model
    call to produce is a warning nobody will wait for.
    """
    count = max(0, section_count)
    tokens_out = count * EST_TOKENS_OUT_PER_SECTION
    tokens_in = sum(
        EST_TOKENS_IN_BASE + EST_TOKENS_IN_PER_PRIOR_SECTION * i for i in range(count)
    )
    return tokens_in, tokens_out
