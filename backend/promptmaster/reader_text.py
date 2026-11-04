"""The deliverable is for its reader, not a record of how it was made (28 Oct).

Sean, HarborDesk test: "The final documents also sometimes include internal
version and review terminology that makes them harder to read." The prompts
around a stage name versions ("Stage v3"), review rounds and instructions, so
the model wrote them into the work. Appended to the stage and chapter
instructions, after NOTATION_RULE.

4 Nov (Sean, Lakeside proposal): the stage writer is told to say things "to the
user in a reply" — what approval covers, that figures were worked by hand, that
no further pass is needed — and its only output was the document. So every
revision ended with a block addressed to him ("Notes for you, outside the
proposal:", "Reply to you, not part of the document:"), Go asked six times for
it to be removed, and each removal brought a new one. The writer now has a place
for that note (`USER_NOTE_MARKER`), and `split_user_note` takes it, or a block
written in its place, off the end of the work in code.
"""

from __future__ import annotations

import re

READER_TEXT_RULE = (
    "WRITTEN FOR ITS READER. The work is the finished document, not a record of how it was made. "
    "Do not mention PromptMaster, stages, versions or drafts (\"v3\", \"version 2\", \"the previous draft\"), "
    "reviews or review rounds, the instructions you were given, or what changed since an earlier version — "
    "unless the brief or the user asks for a change log, revision history or similar record; then that "
    "record goes in its own clearly headed section and nowhere else."
)

#: The line after which the writer's note to the user goes. Taken off in code.
USER_NOTE_MARKER = "=== NOTE FOR THE USER ==="

USER_NOTE_RULE = (
    "YOUR NOTE TO THE USER GOES AFTER THE WORK, NEVER IN IT. Anything you would tell the user rather "
    "than the reader — what an approval does or does not cover, how figures or a count were worked out, "
    "a word count, whether another pass is needed, what you chose and why, which instruction you "
    f"followed — goes after one line reading exactly {USER_NOTE_MARKER} at the very end of your answer. "
    "PromptMaster takes everything after that line off the work and shows it to the user as your reply. "
    "Never write such a note into the work itself, under any heading or label (\"Notes for you\", "
    "\"Outside the document\", \"Reply to you\", \"Notes on this version\"), and never after a "
    "closing horizontal rule. Leave the line out when there is nothing to say."
)

_MARKER = re.compile(r"^[ \t]*[*_>#]*[ \t]*={2,}[ \t]*notes?[ \t]+(?:for|to)[ \t]+the[ \t]+user[ \t]*={2,}[ \t*_]*$", re.IGNORECASE | re.MULTILINE)

#: A line that only separates: a rule, a non-breaking space, a line break.
_SEPARATOR = re.compile(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,}|&nbsp;|<br\s*/?>|\\)?[ \t]*$", re.IGNORECASE)
_RULE = re.compile(r"^[ \t]*(?:-{3,}|\*{3,}|_{3,}|&nbsp;|<br\s*/?>)[ \t]*$", re.IGNORECASE)
_HEADING = re.compile(r"^[ \t]{0,3}#{1,6}[ \t]")

_DOC = r"(?:document|proposal|report|memo|letter|brief|plan|pack|deliverable|text|work|draft|announcement|email|summary|answer|response)"

#: The label of a block addressed to the user, at the start of its first line.
_LABEL = re.compile(
    r"^(?:(?:internal|private|production|process|workflow)[ \t]+)?notes?[ \t]+(?:for|to)[ \t]+(?:you|the[ \t]+user)\b"
    r"|^notes?[ \t]+on[ \t]+(?:this|the)[ \t]+(?:version|draft|revision|update|edit|changes?)\b"
    r"|^(?:a[ \t]+)?(?:reply|message|remarks?)[ \t]+(?:for|to)[ \t]+you\b"
    r"|^(?:production|process|workflow)[ \t]+notes?\b",
    re.IGNORECASE,
)

#: Labels a document may also use for its own content ("Not part of this proposal:
#: follow-up support"): a note only when the block also says what a note says.
_WEAK_LABEL = re.compile(
    rf"^outside[ \t]+(?:the|this)[ \t]+{_DOC}\b"
    rf"|^not[ \t]+part[ \t]+of[ \t]+(?:the|this)[ \t]+{_DOC}\b"
    r"|^status[ \t]+of[ \t]+(?:the|this)[ \t]+(?:results?|work|draft|document)\b",
    re.IGNORECASE,
)

#: What a note to the user says. Two different ones in a block after a closing rule make it a note.
_SIGNALS = (
    re.compile(r"\bapprov\w*\b[^.\n]{0,80}?\bdo(?:es)?(?:n['’]t|[ \t]+not)[ \t]+authori[sz]e", re.IGNORECASE),
    re.compile(r"\bno[ \t]+further[ \t]+(?:drafting[ \t]+)?pass\b|\bfurther[ \t]+drafting\b|\bnext[ \t]+pass\b", re.IGNORECASE),
    re.compile(
        r"\bby[ \t]+hand\b|\bhand[- ](?:estimate|count|counted|arithmetic)\b|\bnot[ \t]+(?:machine|tool)[- ]counted\b"
        r"|\bnot[ \t]+computed\b|\bnot[ \t]+counted[ \t]+(?:it[ \t]+)?with[ \t]+a[ \t]+tool\b|\bnot[ \t]+computed[ \t]+by[ \t]+code\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bword[ \t]+count\b", re.IGNORECASE),
    re.compile(r"\bunless[ \t]+you[ \t]+change[ \t]+a[ \t]+fact\b", re.IGNORECASE),
    re.compile(r"\baccepted[ \t]+findings\b|\byour[ \t]+instruction\b", re.IGNORECASE),
)

#: A note is a few lines, never most of the text.
_NOTE_MAX = 3_000


def _label_of(line: str) -> str:
    """The words a line opens with, without Markdown, up to a colon."""
    bare = re.sub(r"^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*)?[*_]*", "", line).strip()
    head = bare.split(":", 1)[0] if ":" in bare[:100] else bare
    return head.strip(" \t*_")


def _label_kind(line: str) -> str | None:
    """"strong" for a label only a note to the user has, "weak" for one a document may share."""
    head = _label_of(line)
    if not head or len(head) > 80:
        return None
    # Without a colon the line has to be a label on its own, not a sentence of the work.
    if ":" not in line[:110] and len(line.strip()) > 80:
        return None
    if _LABEL.match(head):
        return "strong"
    return "weak" if _WEAK_LABEL.match(head) else None


def _signals(text: str) -> int:
    return sum(1 for s in _SIGNALS if s.search(text))


def _note_text(lines: list[str]) -> str:
    return "\n".join(lines).strip()


def _trailing_block(lines: list[str]) -> int | None:
    """Where a note to the user written into the end of the work starts, if one is there."""
    n = len(lines)
    # Headings after a line rule out everything before it.
    last_heading = max((i for i, l in enumerate(lines) if _HEADING.match(l)), default=-1)
    # (a) A labelled block: the first label line with no other heading after it.
    for i in range(max(last_heading, 0), n):
        kind = _label_kind(lines[i])
        if not kind or not any(l.strip() for l in lines[:i]):
            continue
        block = "\n".join(lines[i:])
        if len(block) > _NOTE_MAX:
            return None
        if kind == "strong" or _signals(block) >= 1:
            return i
    # (b) An unlabelled block after a closing rule that says two things only a note says.
    rules = [i for i, l in enumerate(lines) if _RULE.match(l) and i > last_heading]
    if not rules:
        return None
    start = rules[-1]
    body = "\n".join(lines[start + 1 :])
    if not body.strip() or len(body) > _NOTE_MAX or not any(l.strip() for l in lines[:start]):
        return None
    return start + 1 if _signals(body) >= 2 else None


def split_user_note(text: str) -> tuple[str, str]:
    """The work, and the note to the user taken off its end ("" when there is none)."""
    if not text or not text.strip():
        return text, ""
    notes: list[str] = []
    work = text
    m = _MARKER.search(work)
    if m:
        notes.append(work[m.end() :].strip())
        work = work[: m.start()]
    lines = work.rstrip().split("\n")
    start = _trailing_block(lines)
    if start is not None:
        block = lines[start:]
        while block and _SEPARATOR.match(block[0]):
            block = block[1:]
        notes.insert(0, _note_text(block))
        lines = lines[:start]
    if not notes:
        return text, ""
    # The rule or blank line that separated the note goes with it.
    while lines and _SEPARATOR.match(lines[-1]):
        lines.pop()
    return "\n".join(lines).rstrip(), "\n\n".join(n for n in notes if n)
