"""Stock enthusiasm said once, not every time (28 Oct).

Colette, via Sean: "How cool is that?" kept coming back. The self-model asks
for plain writing; this is the half that does not depend on the model
listening. A short exclamation or rhetorical question ("How cool is that?",
"Pretty neat, right?") that the text — or an earlier reply, or the previous
chapter — has already used is taken out. A filler opener ("Great question!")
is taken out of a chat reply every time. Pure; applied by the routers that
return prose.
"""

from __future__ import annotations

import re

#: At most this many words: a catchphrase, not a sentence with content.
_SHORT = 6

_FILLER_OPENERS = re.compile(
    r"^(?:great|good|excellent|what a great|that'?s a great|love this|love that) "
    r"(?:question|point|idea|thought)s?\s*[!.]\s*",
    re.I,
)

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[\"“(]?[A-Z0-9])")


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", "", re.sub(r"[’']", "", s.lower())).strip()


def _is_catchphrase(sentence: str) -> bool:
    s = sentence.strip().strip("*_")
    return bool(s) and s[-1] in "!?" and len(s.split()) <= _SHORT


def _catchphrases(text: str) -> set[str]:
    return {_key(s) for line in text.splitlines() for s in _SENTENCE_END.split(line) if _is_catchphrase(s)}


def without_repeated_catchphrases(text: str, earlier: list[str] | tuple[str, ...] = (), *, chat: bool = False) -> str:
    """The text with each catchphrase kept only the first time it is used.

    `earlier` holds what came before — previous replies, the previous chapter:
    a catchphrase used there is not used again here. Table rows, headings and
    code are left alone.
    """
    if not text.strip():
        return text
    seen: set[str] = set()
    for e in earlier:
        seen |= _catchphrases(e or "")
    out: list[str] = []
    fenced = False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if fenced or line.lstrip().startswith(("|", "#", "```")):
            out.append(line)
            continue
        marker = re.match(r"^\s*(?:[-*+]|\d+[.)]|>)\s+", line)
        head = marker.group(0) if marker else ""
        parts = _SENTENCE_END.split(line[len(head):])
        kept: list[str] = []
        for p in parts:
            if _is_catchphrase(p):
                k = _key(p)
                if k in seen:
                    continue
                seen.add(k)
            kept.append(p)
        if len(kept) == len(parts):
            out.append(line)
        elif " ".join(kept).strip():
            out.append(head + " ".join(kept))
    result = "\n".join(out)
    if chat:
        result = _FILLER_OPENERS.sub("", result.lstrip(), count=1)
    return re.sub(r"\n{3,}", "\n\n", result).strip() if result != text else text
