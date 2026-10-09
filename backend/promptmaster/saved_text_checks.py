"""Checks that verify the saved text instead of describing it (A1, 8 Oct).

Sean, 7 Oct (TeamNotes): a consistency check said "no mobile app" and "no
free trial" were missing from both documents, which stated them; it
questioned browser access the FAQ confirmed in question 4. Emails 2 and 5:
review text "described what the report should contain instead of checking
whether the saved output actually contained it", and claimed 26 combinations
covered where the saved output listed 25.

Two halves. The rule tells a check to look in the saved documents, quote the
words it looked for, and count rather than estimate. The guard, in code,
drops a claim that something is missing when the words it quotes are in the
saved text after all — the same kind of guard as extract-figures' verbatim
rule. A claim with no quote cannot be verified either way and is kept.
"""

from __future__ import annotations

import re

VERIFY_RULE = (
    "CHECK THE SAVED TEXT, DO NOT DESCRIBE IT. Every finding is about what the saved "
    "documents above actually say. Before you say something is missing, search the saved "
    "text for it; when you still say it is missing, put the exact words you looked for in "
    "double quotes. Before you claim a count or full coverage (\"all 26 combinations\", "
    "\"only feasible options\"), count the items in the saved text and give that count. "
    "Where the brief limits the work to supplied facts, flag any claim or benefit wording "
    "that no supplied fact supports (\"helps keep everyone aligned\", \"makes it easy\")."
)

_MISSING = re.compile(
    r"\b(missing|absent|omit(?:s|ted)?|not (?:mention(?:ed)?|state[ds]?|include[ds]?|present|confirm(?:ed|s)?|shown|covered)|does not (?:mention|state|include|say|confirm)|doesn't (?:mention|state|include|say|confirm)|lacks?|no mention)\b",
    re.I,
)
_QUOTED = re.compile(r"[\"“”‘’']([^\"“”‘’']{3,120})[\"“”‘’']")


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[*_`#>|\\]", " ", text).lower().split())


def disproved_missing(claim: str, saved_text: str) -> bool:
    """A claim that something is missing whose quoted words are in the saved text."""
    if not _MISSING.search(claim):
        return False
    quotes = [q.strip() for q in _QUOTED.findall(claim) if q.strip()]
    if not quotes:
        return False
    haystack = _norm(saved_text)
    return all(_norm(q) in haystack for q in quotes)
