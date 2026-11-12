"""What code counted on a text, as every check of it is told (4 Nov).

Sean, support-software memo: a check row said "Estimated length is about
470–490 words … No word count was run", and a later check applied "a hand
estimate by section", beside a memo the code had counted. "If a measurement
hasn't run, show the limit as unverified." The counts are made in the browser
(`lib/workflow/measurable.ts`, `context.ts::measuredLines`) and handed to the
check, the check table and the routine-approval check, which report them
rather than estimate them.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field


class MeasuredLine(BaseModel):
    label: str = Field(max_length=300)
    value: str = Field(default="", max_length=300)
    #: None: code could not count it.
    met: bool | None = None
    #: A plain count with no limit attached (12 Nov): "Draft memo — length: 588 words". A check
    #: that is given no count estimates one, and one check then asked a memo to "state the word
    #: count, labelled as an estimate".
    info: bool = False


#: "about 470-490 words", "No word count was run", "by hand reading only", "states no word count".
_HAND_COUNT = re.compile(
    r"\b(?:about|roughly|approximately|around|an? estimated?|estimated?|~)\s*[\d,]+(?:\s*[–-]\s*[\d,]+)?\s*words\b"
    r"|\bno word count was run\b|\bhand (?:count|estimate|reading)\b|\bby (?:hand|my count)\b"
    r"|\bstates? no word count\b|\bnot counted by a tool\b",
    re.I,
)


def counted_words(lines: list[MeasuredLine] | None) -> bool:
    """Whether code counted a length in words on the text a check reads."""
    return any((line.info or line.met is not None) and re.search(r"\bwords\b", f"{line.label} {line.value}") for line in (lines or []))


def is_hand_count(text: str) -> bool:
    """A finding that estimates a length by eye, or notes that the text does not state its own."""
    return bool(_HAND_COUNT.search(text or ""))


MAX_LINES = 24


def measured_block(lines: list[MeasuredLine], what: str = "THIS TEXT") -> str:
    """The counts as a prompt block; '' when there are none."""
    if not lines:
        return ""
    rows = []
    for line in lines[:MAX_LINES]:
        if line.info:
            rows.append(f"- {line.label}: {line.value or '(counted)'} (counted in code)")
        elif line.met is None:
            rows.append(f"- {line.label}: NOT VERIFIED — {line.value or 'code could not count it'}")
        else:
            rows.append(f"- {line.label}: {line.value or '(counted)'} — {'met' if line.met else 'NOT met'}")
    return (
        f"MEASURED IN CODE ON {what} (exact counts of the saved text). Report a length or count limit as met or "
        "not met only from these; never estimate one, never count by hand, never contradict them, and never "
        "write a finding that only restates one. A limit marked NOT VERIFIED was not counted: say it is not "
        "verified, do not estimate it. A length is the page's to show from these counts: never ask the text to "
        "state its own word count, and never suggest adding a word count or an estimate of one.\n" + "\n".join(rows)
    )
