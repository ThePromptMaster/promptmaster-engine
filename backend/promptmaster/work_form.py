"""The form of the work, read from the brief (13 Oct; Sean's screenplay test).

A screenplay, a stage play or a novel runs through the Book workflow, whose
stage instructions say "book" and "chapter". The workflow is reusable; the
words are not. This reads the form the user asked for from the objective,
the output format and the constraints — a keyword map, never a model call —
so every prompt can say what is being made and how it is written, and the
fact-check can tell invented story material from claims about the world.

Mirrored in `frontend/src/lib/workflow/work-form.ts`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .schemas import PMInput


@dataclass(frozen=True)
class WorkForm:
    key: str
    #: What it is called, as a noun phrase: "a feature-length screenplay".
    name: str
    #: What a book's chapter is in it.
    unit: str
    fiction: bool
    #: How it is written, for drafting prompts.
    format_rule: str


_FORMS: list[tuple[re.Pattern[str], WorkForm]] = [
    (
        re.compile(r"\b(screen\s?play|screen-play|film script|movie script|teleplay|feature[- ]length script)s?\b", re.I),
        WorkForm(
            "screenplay", "a screenplay", "sequence", True,
            "Write it as a screenplay: scene headings (INT./EXT. PLACE — TIME), action lines in the present "
            "tense, character names above their dialogue, and parentheticals only where needed. No prose "
            "narration, no chapter headings, no options or alternatives left for the writer — every scene "
            "is decided.",
        ),
    ),
    (
        re.compile(r"\b(stage play|stageplay|play script|theatre script|theater script|one-act play|two-act play|three-act play)s?\b", re.I),
        WorkForm(
            "play", "a stage play", "scene", True,
            "Write it as a stage play: act and scene headings, stage directions in italics or brackets, "
            "character names before their lines. No prose narration, no chapter headings.",
        ),
    ),
    (
        re.compile(r"(?<![-\w])(novel|novella|short story|short stories|fiction|fictional story)\b", re.I),
        WorkForm("novel", "a work of fiction", "chapter", True, "Write it as narrative prose fiction."),
    ),
]


def form_of(inputs: PMInput) -> WorkForm | None:
    """The form the brief names, or None for a book, report or anything else."""
    text = " ".join(x for x in (inputs.objective, inputs.output_format, inputs.constraints) if x)
    for pattern, form in _FORMS:
        if pattern.search(text):
            return form
    return None


def form_block(inputs: PMInput) -> str:
    """One block for every prompt: what is being made, and the words to read the workflow's in."""
    form = form_of(inputs)
    if not form:
        return ""
    lines = [
        f"THE FORM OF THE WORK: {form.name}. The workflow's stage instructions are written for a book; "
        f"wherever they say book, read {form.key}; wherever they say chapter, read {form.unit}; "
        f"wherever they say manuscript, read the {form.key}'s text. Say {form.key} and {form.unit} "
        "yourself — never book or chapter.",
        form.format_rule,
    ]
    return "\n".join(lines)


#: For the fact-check of a work of fiction (13 Oct, Sean: 20 rows asking for a
#: source for the fictional Adrien's birthplace, errands and conversations).
FICTION_CLAIMS_RULE = (
    "THIS WORK IS FICTION. Sort what the draft says into four kinds before you write a row:\n"
    "1. Invented characters, scenes, documents, conversations and events of the story — the "
    "work made them up, and no outside source could or should confirm them. Do not give each one a "
    "row. If an invented detail is presented as historical fact (a made-up decree dated as if real), "
    "give it one row with status 'fiction' and a reason saying it is invented.\n"
    "2. Internal continuity — whether the story agrees with itself. That is not a factual claim; "
    "leave it out (the continuity review covers it).\n"
    "3. Historical setting and plausibility — what a period, place or institution was like "
    "(curfews, uniforms, how a tribunal sat). These ARE claims: give each a row.\n"
    "4. Claims about real dates, institutions and real people. These ARE claims: give each a row.\n"
    "Set every row's 'kind': 'real world' for 4, 'historical setting' for 3, 'invented' for "
    "the work's own material. A row about something the work made up is 'invented', however "
    "official it sounds — a made-up memorandum, decree, register or search is invented.\n"
    # 13 Oct production pass: lines spoken by invented characters, about each
    # other, came back as "historical setting" claims needing archive sources.
    "Anything that matters only because of who did or said it in the story — a character's "
    "history, errands, relationships, documents or lines — is 'invented', even when it sounds "
    "plausible for the period. A 'historical setting' row states the general period fact a "
    "source could confirm on its own, in your words, not the scene: write \"Paris district "
    "committees issued their own search warrants in 1793\", never \"Lucien says the committee "
    "searches begin after sunrise\". Leave out a setting detail no reader could get wrong.\n"
    "A passage the draft leaves undecided — alternatives such as \"If he sees… / If he does not see "
    "her…\" — is a drafting problem, not a claim: leave it out (the critique covers it)."
)
