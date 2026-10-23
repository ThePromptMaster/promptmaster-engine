"""The language a project's work is written in (client, 21 Oct: "Can we do pick your language?").

Chosen per project in the browser and sent with every request as the
`X-PromptMaster-Language` header, like the thinking level, so every model call
that request makes — the draft, its checks, the side chat, Go's planner —
writes alike without the language being threaded through each engine function.
`llm_client` adds `language_directive` to every call's system message; nothing
else needs to know.

English is the default and adds nothing to a prompt. Only languages written
with spaces between words are offered: word limits and section measures count
words by spaces.
"""

from __future__ import annotations

#: code → (English name, the language's own name). Mirrored in the browser by
#: `frontend/src/lib/workflow/languages.ts`; a test keeps the two equal.
LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("English", "English"),
    "es": ("Spanish", "español"),
    "fr": ("French", "français"),
    "pt": ("Portuguese", "português"),
    "de": ("German", "Deutsch"),
    "it": ("Italian", "italiano"),
    "nl": ("Dutch", "Nederlands"),
}

DEFAULT_LANGUAGE = "en"


def resolve(code: str | None) -> str:
    """An offered code, or English for anything else — an unknown value never changes the output."""
    c = (code or "").strip().lower()[:2]
    return c if c in LANGUAGES else DEFAULT_LANGUAGE


def language_directive(code: str | None) -> str:
    """The instruction for a non-English project; "" for English."""
    c = resolve(code)
    if c == DEFAULT_LANGUAGE:
        return ""
    name, own = LANGUAGES[c]
    return (
        f"OUTPUT LANGUAGE — write everything the user will read in {name} ({own}): the work itself, "
        "headings, explanations, questions, reasons and suggestions. Keep exactly as written: "
        "quotations, figures with their units, names, titles of works, citations such as [S1], URLs "
        "and code. Where you are asked to copy text from the material (a quote, a figure, a fact's "
        f"wording), copy it as it is, in whatever language it is in. In JSON, keys and fixed values "
        "(High/Medium/Low, statuses, ids, true/false) stay exactly as specified; only free-text "
        f"values are in {name}."
    )
