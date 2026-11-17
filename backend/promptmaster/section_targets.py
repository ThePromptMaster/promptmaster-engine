"""Which sections of a manuscript a change concerns, and whether it is already made (17 Nov).

Sean's book (15–16 Nov): one chapter was retitled. The chapter plan's repair had
already put the new title in the chapters, and yet the reopened manuscript was
repaired by rewriting every one of its 26 sections, twelve times over, for about
$63, and nothing in the text changed. A repair now asks first. It sends why the
manuscript was reopened and an excerpt of each section: its title, its opening,
and the lines that mention what changed (found in the browser). It gets back
which sections must change for that reason, and whether the change is already in
the text.

Section ids the model invents are dropped in code. "Already made" lists no
sections. Any failure returns `checked = False`, and the browser falls back to
the sections that still hold an old value (found in code), or stops and says so.
It never falls back to rewriting the whole manuscript. A check, so it never
searches the web.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

#: Picking sections from excerpts does not need the default model.
SECTIONS_MODEL = "anthropic/claude-sonnet-5.5"

MAX_SECTIONS = 200

SECTIONS_INSTRUCTION = (
    "A manuscript was reopened for a reason, and is about to be repaired one section at a time. Rewriting "
    "a section is expensive, so only the sections that must change for this reason are rewritten. For each "
    "SECTION you are given its id, its title, its opening, and the lines in it that mention what changed.\n\n"
    "Decide:\n"
    "- sections: the sections whose text must change because of the reason. They are the ones that "
    "state what the reason says is old or wrong, or that the reason names. A section on the same subject "
    "that the reason does not concern is NOT listed.\n"
    "- already_done: true only when the titles and excerpts show the change is already made wherever it "
    "applies. For example, the new title already heads the chapter and nothing shown still uses the old "
    "one, or every changed value already reads the new way. When already_done is true, list no sections.\n"
    "- When the reason is about the whole manuscript (its voice, its consistency throughout, a term used "
    "everywhere), list every section it applies to.\n"
    "- If you cannot tell from the excerpt whether a section must change, list it.\n\n"
    "Return JSON only: {\"already_done\": false, \"sections\": [{\"id\": \"...\", \"why\": \"one short "
    "sentence\"}], \"note\": \"one sentence on what you found\"}"
)


class SupersededPair(BaseModel):
    was: str = Field(default="", max_length=400)
    now: str = Field(default="", max_length=400)


class SectionExcerpt(BaseModel):
    id: str = Field(..., min_length=1, max_length=120)
    title: str = Field(default="", max_length=400)
    #: The opening and the lines that mention what changed, chosen in the browser.
    excerpt: str = Field(default="", max_length=4_000)


class SectionsToRepairRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=4_000)
    superseded: list[SupersededPair] = Field(default_factory=list, max_length=40)
    sections: list[SectionExcerpt] = Field(default_factory=list, max_length=MAX_SECTIONS)
    model: str = Field(default="", max_length=200)


class SectionToRepair(BaseModel):
    id: str
    why: str = ""


class SectionsToRepairResponse(BaseModel):
    #: False when no answer was had: the browser does not take an empty list as "nothing to do".
    checked: bool = False
    already_done: bool = False
    sections: list[SectionToRepair] = Field(default_factory=list)
    note: str = ""


def build_sections_prompt(req: SectionsToRepairRequest) -> tuple[str, str]:
    changes = "\n".join(f"- was \"{p.was}\", now \"{p.now}\"" for p in req.superseded if p.was or p.now) or "(none recorded)"
    sections = "\n\n".join(
        f"[{s.id}] {' '.join(s.title.split()) or '(untitled)'}\n{s.excerpt.strip() or '(no text)'}" for s in req.sections
    )
    user = (
        f"WHY THE MANUSCRIPT WAS REOPENED: {' '.join(req.reason.split())}\n\n"
        f"VALUES THE PROJECT REPLACED:\n{changes}\n\n"
        f"SECTIONS:\n{sections}"
    )
    return SECTIONS_INSTRUCTION, user


def parse_sections(result: object, req: SectionsToRepairRequest) -> SectionsToRepairResponse:
    """Only the ids given, each once, in the manuscript's order; none when already made."""
    if not isinstance(result, dict):
        return SectionsToRepairResponse()
    known = [s.id for s in req.sections]
    note = " ".join(str(result.get("note") or "").split())[:300]
    if result.get("already_done") is True:
        return SectionsToRepairResponse(checked=True, already_done=True, note=note)
    named: dict[str, str] = {}
    for raw in result.get("sections") or []:
        if isinstance(raw, str):
            sid, why = raw.strip().strip("[]"), ""
        elif isinstance(raw, dict):
            sid = str(raw.get("id") or "").strip().strip("[]")
            why = " ".join(str(raw.get("why") or "").split())[:300]
        else:
            continue
        if sid in known and sid not in named:
            named[sid] = why
    ordered = [SectionToRepair(id=sid, why=named[sid]) for sid in known if sid in named]
    return SectionsToRepairResponse(checked=True, sections=ordered, note=note)


async def sections_to_repair(client: OpenRouterClient, req: SectionsToRepairRequest) -> SectionsToRepairResponse:
    if not req.sections:
        return SectionsToRepairResponse()
    system, user = build_sections_prompt(req)
    result, _usage = await client.generate_json(prompt=user, system=system, temperature=0, max_tokens=1_500, model=SECTIONS_MODEL)
    return parse_sections(result, req)
