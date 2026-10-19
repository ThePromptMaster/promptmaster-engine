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
#: "This supersedes the proposed 100 hours": the word names the earlier
#: figure, not a request someone is making. It made the CEO's authorization a
#: request in Ridgeway (Sean, 18 Oct, email 9).
_NAMING_EARLIER = re.compile(
    r"\b(?:the|a|an|its|their|his|her|earlier|original|originally|previously|initially|first)\s+"
    r"(?:proposed|requested|suggested)\b",
    re.I,
)
#: An authority granting something: "The CEO authorizes…", "Elena approved…",
#: "the board signed off on…". Granting, not asking.
APPROVAL = re.compile(
    r"\b(?:authori[sz]es|authori[sz]ed|approves|approved|signs? off|signed off|grants|granted|sanctions|sanctioned)\b",
    re.I,
)
#: …unless the sentence says it was not granted, or only asks for it:
#: "has not approved", "treat $46,000 as approved", "asks the board to approve",
#: "once approved", "pending approval".
_NOT_GRANTED = re.compile(
    r"\b(?:not|never|no longer|yet to be|to be|be|as|once|if|until|unless|when|pending)\s+"
    r"(?:\w+\s+)?(?:authori[sz]ed|approved|signed off|granted|sanctioned)\b"
    r"|\b(?:unapproved|unauthori[sz]ed)\b"
    r"|\b(?:asks?|asked|requests?|requested|wants?|seeks?|sought)\b[^.;]*\b(?:approv|authori[sz]|sign)",
    re.I,
)


#: "The existing training rules remain unchanged", "Keep the review date as it
#: was": a statement that something stays as recorded. Without a figure it
#: adds nothing the record does not already hold, so it is not a new fact or a
#: requirement (18 Oct, production pass: REEF stored "All existing dependency
#: and duration rules remain unchanged" as a requirement).
UNCHANGED = re.compile(
    r"\b(?:remain|remains|stay|stays|is|are|was|were)\s+(?:unchanged|the same|as (?:before|they were|it was|is))\b",
    re.I,
)
KEEP_AS_IS = re.compile(
    r"^(?:please\s+)?(?:keep|leave|retain)\b.*\b(?:as (?:it|they) (?:was|were|is|are|stands?)|as (?:before|is)|unchanged|the same)\W*$",
    re.I,
)
#: "All other facts remain unchanged except that the launch is November 24":
#: only the change after "except" is a statement worth recording.
_EXCEPT = re.compile(r"\b(?:remain|remains|stay|stays|is|are)\s+(?:unchanged|the same)\s*,?\s+except\s+(?:that\s+|for\s+)?", re.I)


def the_change(statement: str) -> str:
    """A statement less any "everything else is unchanged, except that" preface."""
    m = _EXCEPT.search(statement)
    if not m:
        return statement
    rest = statement[m.end():].strip()
    return rest[:1].upper() + rest[1:] if rest else statement


def records_nothing(statement: str) -> bool:
    """Filler, a statement that something stays as recorded, or an instruction
    about how to handle this request: never a fact."""
    if FILLER.search(statement) or PROCESS.search(statement):
        return True
    no_figure = not _NUMBER.search(statement)
    return no_figure and bool(UNCHANGED.search(statement) or KEEP_AS_IS.search(statement))


def is_approval(statement: str) -> bool:
    """An authority granting something in so many words, and not a sentence
    that says it was refused, is pending, or is only being asked for."""
    return bool(APPROVAL.search(statement)) and not _NOT_GRANTED.search(statement)


def is_request(statement: str) -> bool:
    """A request, suggestion or proposal by someone: recorded as a fact about it,
    never a requirement. An approval is never a request, and "the proposed 100
    hours" only names the figure an approval replaces."""
    if is_approval(statement):
        return False
    return bool(REQUEST.search(_NAMING_EARLIER.sub(" ", statement)))


#: Who grants it: the words before the verb ("The CEO", "Elena", "the board").
_APPROVER = re.compile(
    r"(?:^|[.;:]\s+)(?:[Tt]he\s+)?([A-Za-z][\w&'’ -]{0,58}?)\s+(?:has\s+|have\s+|formally\s+|now\s+)?"
    r"(?:authori[sz]es|authori[sz]ed|approves|approved|signs? off|signed off|grants|granted|sanctions|sanctioned)\b"
)


def approver(statement: str) -> str:
    """The authority an approval names, as written: "CEO", "Elena", "board"; "" when none is named."""
    m = _APPROVER.search(statement)
    return " ".join(m.group(1).split()) if m else ""


def classify(statement: str, model_label: object = "", model_authority: object = "") -> tuple[str, str]:
    """("approval", who) | ("request", "") | ("fact", "").

    The code reads the verb first: an authority granting something is an
    approval, whatever the model said, and a request word makes it a request.
    The model's label only decides what the words do not: it can call a
    sentence a request (the safer reading), and an approval only when it names
    who granted it and the sentence grants something.
    """
    if is_approval(statement):
        return "approval", approver(statement) or " ".join(str(model_authority or "").split())[:80]
    if is_request(statement):
        return "request", ""
    label = str(model_label or "").strip().lower()
    if label == "request":
        return "request", ""
    return "fact", ""


def record_kind(kind: object, statement: str) -> str:
    """A requirement only when asked for and not a request; otherwise a fact."""
    return "requirement" if kind == "requirement" and not is_request(statement) else "fact"


#: The prompt rules that go with the code above, for every path that offers facts.
RULES = (
    "- Leave out filler such as \"all other facts remain unchanged\", \"the existing rules remain "
    "unchanged\" or \"keep X as it was\": they record nothing. From \"everything else is unchanged "
    "except that X\", record only X.\n"
    "- An instruction about how to handle THIS request (\"before recording anything, "
    "explain…\", \"don't revise yet\", \"first calculate…\") is not a fact or a "
    "requirement: never record it.\n"
    "- A request, suggestion or proposal by someone in the project (\"Luis asks to count "
    "those days\", \"Omar's note says to treat $46,000 as approved\") is recorded as a fact "
    "about the request, never as a requirement: nobody has approved it.\n"
    "- An authority granting something (\"The CEO authorizes up to 75 hours\", \"the board "
    "approved the budget\") is an approval, not a request, even where it replaces an earlier "
    "proposed figure. Say who granted it.\n"
)
