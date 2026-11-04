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

from pydantic import BaseModel, Field


class MeasuredLine(BaseModel):
    label: str = Field(max_length=300)
    value: str = Field(default="", max_length=300)
    #: None: code could not count it.
    met: bool | None = None


MAX_LINES = 24


def measured_block(lines: list[MeasuredLine], what: str = "THIS TEXT") -> str:
    """The counts as a prompt block; '' when there are none."""
    if not lines:
        return ""
    rows = []
    for line in lines[:MAX_LINES]:
        if line.met is None:
            rows.append(f"- {line.label}: NOT VERIFIED — {line.value or 'code could not count it'}")
        else:
            rows.append(f"- {line.label}: {line.value or '(counted)'} — {'met' if line.met else 'NOT met'}")
    return (
        f"MEASURED IN CODE ON {what} (exact counts of the saved text). Report a length or count limit as met or "
        "not met only from these; never estimate one, never count by hand, never contradict them, and never "
        "write a finding that only restates one. A limit marked NOT VERIFIED was not counted: say it is not "
        "verified, do not estimate it.\n" + "\n".join(rows)
    )
