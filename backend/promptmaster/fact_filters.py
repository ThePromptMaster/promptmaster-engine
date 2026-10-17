"""What may be recorded as an accepted fact, checked in code.

Two paths offer facts for recording: a chat reply's "Record these facts"
(`reply_actions.parse_record_facts`) and a revision's own fact changes
(`revision_facts`). Until 17 Oct only the first had these filters, so a
revision's "Apply and update 6 facts" carried "other information remains
unchanged", an instruction about handling the request, and a person's request
stored as a requirement (Sean, 15 Oct, HARBOR). One module, both paths.
"""

from __future__ import annotations

import re

_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
_WORD = re.compile(r"[a-zA-Z]{4,}")


def from_user(statement: str, user_text: str) -> bool:
    """A fact to record must be the user's: every figure in it appears in what
    the user wrote, and, without figures, most of its words do. A model that
    "records" a figure from its own answer is the stale-evidence problem in
    another form."""
    q = user_text.lower().replace(",", "")
    numbers = [n.replace(",", "") for n in _NUMBER.findall(statement)]
    if numbers:
        return all(n in q for n in numbers)
    words = [w.lower() for w in _WORD.findall(statement)]
    return bool(words) and sum(w in q for w in words) >= max(1, (len(words) + 1) // 2)


#: "All other facts and approvals remain unchanged": a sentence that records
#: nothing. SUMMIT stored it four times over (Sean, 14 Oct).
FILLER = re.compile(
    r"^(?:all |everything |any )?(?:other|else|remaining|the rest of the)\b[\w\s,/&-]*?\b"
    r"(?:remain|remains|stay|stays|is|are)\s+(?:unchanged|the same|as (?:before|they were|it was))\b",
    re.I,
)
#: How to handle this one request, addressed to the assistant: "Before
#: recording anything or revising documents, explain the conflict…" became a
#: standing requirement in SUMMIT (Sean, 14 Oct, email 5).
PROCESS = re.compile(
    r"^(?:please\s+)?(?:before (?:you |recording|revising|updating|changing|doing|making|we )|"
    r"first,? (?:explain|calculate|check|tell|show|list)|"
    r"(?:do not|don't|don’t) (?:record|revise|update|change|edit) (?:anything|the|any|yet)|"
    r"wait (?:before|until)|for now,? (?:do not|don't|just)|"
    r"(?:explain|calculate|identify|tell me|show me)\b.*\bbefore (?:recording|revising|updating))",
    re.I,
)
#: Someone in the project asking for something: a fact about a request.
REQUEST = re.compile(r"\b(?:asks?|asked|requests?|requested|suggests?|suggested|proposes?|proposed|wants?|would like)\b", re.I)


def records_nothing(statement: str) -> bool:
    """Filler, or an instruction about how to handle this request: never a fact."""
    return bool(FILLER.search(statement) or PROCESS.search(statement))


def is_request(statement: str) -> bool:
    """A request, suggestion or proposal by someone: recorded as a fact about it, never a requirement."""
    return bool(REQUEST.search(statement))


def record_kind(kind: object, statement: str) -> str:
    """A requirement only when asked for and not a request; otherwise a fact."""
    return "requirement" if kind == "requirement" and not is_request(statement) else "fact"


#: The prompt rules that go with the code above, for every path that offers facts.
RULES = (
    "- Leave out filler such as \"all other facts remain unchanged\": it records nothing.\n"
    "- An instruction about how to handle THIS request (\"before recording anything, "
    "explain…\", \"don't revise yet\", \"first calculate…\") is not a fact or a "
    "requirement: never record it.\n"
    "- A request, suggestion or proposal by someone in the project (\"Luis asks to count "
    "those days\", \"Omar's note says to treat $46,000 as approved\") is recorded as a fact "
    "about the request, never as a requirement: nobody has approved it.\n"
)
