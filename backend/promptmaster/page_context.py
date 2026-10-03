"""Where the user is: the stage, the workflow, the work so far and the buttons.

The side chat used to be given the brief and the text on screen, and nothing
else. Asked about the outline on a chapter stage, or about the chapters on a
review stage, it asked the user to paste them back (the client, 3 Oct: "paste
the full text of all three chapters back in the box"), and it named buttons the
page did not have ("Press Generate Outline" on the Approval stage). Everything
here is assembled by the client, which already holds the project; the backend
stays stateless.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .schemas import StageDigestEntry


class PageButton(BaseModel):
    """One button on the stage's page: its exact words, and where it is."""

    label: str = Field(max_length=200)
    where: str = Field(default="", max_length=200)


class ChatContext(BaseModel):
    """What the side chat may know about the project beyond the brief."""

    stage_label: str = Field(default="", max_length=200)
    #: The stage's authored instruction: what this stage produces.
    stage_instruction: str = Field(default="", max_length=4_000)
    workflow_label: str = Field(default="", max_length=200)
    #: Stage labels in order; the current one is `stage_label`.
    workflow_stages: list[str] = Field(default_factory=list, max_length=40)
    prior_stages: list[StageDigestEntry] = Field(default_factory=list, max_length=40)
    #: The outline as readable lines ("1. Title — what it covers").
    outline: str = Field(default="", max_length=40_000)
    #: The drafted chapters, bounded by the client (digest.ts, MANUSCRIPT_MAX).
    manuscript: str = Field(default="", max_length=200_000)
    #: None when the client did not say; [] when the page has none.
    buttons: list[PageButton] | None = Field(default=None, max_length=40)


NEVER_PASTE_RULE = (
    "Everything the project holds that bears on this conversation is given to you "
    "above: the stage, the earlier stages, the outline and the chapters. Never ask "
    "the user to paste, copy or re-enter any of it. If something you need is "
    "genuinely not here, say which stage holds it instead."
)


def format_buttons(buttons: list[PageButton] | None) -> str:
    """The page's buttons as a block, with the one rule about naming them."""
    if buttons is None:
        return "BUTTONS ON THIS PAGE NOW: not known. Do not name any button."
    if not buttons:
        return "BUTTONS ON THIS PAGE NOW: none. Do not name any button."
    return (
        "BUTTONS ON THIS PAGE NOW (the user presses these; name one only in these exact words, "
        "in quotes, and never a button that is not listed):\n"
        + "\n".join(f'- "{b.label}" — {b.where}' if b.where else f'- "{b.label}"' for b in buttons)
    )


def format_chat_context(ctx: ChatContext | None) -> str:
    """The block that tells the chat where the user is. '' when nothing was sent,
    so a caller that predates it gets exactly the old prompt."""
    if ctx is None:
        return ""
    lines: list[str] = ["WHERE THE USER IS"]
    if ctx.workflow_stages:
        here = ctx.stage_label
        marked = [f"[{s}]" if s == here else s for s in ctx.workflow_stages]
        lines.append(f"Workflow: {ctx.workflow_label or 'project'} — " + " › ".join(marked))
    if ctx.stage_label:
        lines.append(f"Current stage: {ctx.stage_label}")
    if ctx.stage_instruction.strip():
        lines.append(f"What this stage produces: {ctx.stage_instruction.strip()}")
    if ctx.prior_stages:
        lines.append("What the earlier stages established:")
        lines += [f"- {e.label or e.stage_id}: {e.summary.strip() or '(no summary)'}" for e in ctx.prior_stages]
    if ctx.outline.strip():
        lines += ["", "THE OUTLINE:", ctx.outline.strip()]
    if ctx.manuscript.strip():
        lines += [
            "",
            "THE CHAPTERS AS DRAFTED:",
            "--- BEGIN MANUSCRIPT ---",
            ctx.manuscript.strip(),
            "--- END MANUSCRIPT ---",
        ]
    lines += ["", format_buttons(ctx.buttons), "", NEVER_PASTE_RULE]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Button names in free text
# --------------------------------------------------------------------------
#
# Go's `params.control` was already checked against the page, but the words
# around it were not: "Press Generate Outline" reached the client on a stage
# with no such button (3 Oct call). Telling the model is not enough on its
# own, so what it writes for the user is checked here too.

_QUOTES = "\"'“”‘’"
_VERBS = r"(?i:press|click(?:\s+on)?|tap|hit|select|use)"
# "press 'X'" / "click “X” button"
_QUOTED = re.compile(
    rf"\b({_VERBS})\s+(?:the\s+)?[{_QUOTES}]([^{_QUOTES}\n]{{2,60}})[{_QUOTES}](\s+button)?",
    re.IGNORECASE,
)
# "Press Generate Outline" — a run of capitalised words after the verb.
_TITLED = re.compile(
    rf"\b({_VERBS})\s+(?:the\s+)?((?:[A-Z][\w'/-]*)(?:\s+(?:the\s+|a\s+|to\s+|and\s+)?[A-Z][\w'/-]*){{0,5}})(\s+button)?",
)
_ARTICLES = re.compile(r"\b(the|a|an|this|your)\b", re.IGNORECASE)


def _norm(label: str) -> str:
    return " ".join(_ARTICLES.sub(" ", label.lower()).split())


def scrub_button_mentions(text: str, buttons: list | None, also: tuple[str, ...] = ()) -> str:
    """Rewrite any "press X" whose X is not a button on the page.

    A name that matches a real button but for case or an article ("Generate
    Outline" for "Generate the outline") is corrected to the page's words. Any
    other is replaced by its plain words, said not to be a button here — the
    user is never sent looking for something that does not exist.
    """
    if not text:
        return text
    real = {_norm(b.label): b.label for b in (buttons or []) if getattr(b, "label", "").strip()}
    # Buttons that are always there for this caller (Go's own: Resume, Stop).
    real.update({_norm(label): label for label in also})

    def fix(m: re.Match) -> str:
        verb, name = m.group(1), m.group(2).strip()
        hit = real.get(_norm(name))
        if hit:
            return f'{verb} "{hit}"'
        words = name.lower()
        before = m.string[: m.start()].rstrip()
        if not before or before.endswith((".", "!", "?", ":", "\n")):
            words = words[0].upper() + words[1:]
        return f"{words} (there is no button for this on this page)"

    def fix_quoted(m: re.Match) -> str:
        # "use 'Stay within scope' as a constraint" quotes words, not a button.
        if m.group(1).lower() in ("use", "select") and not m.group(3) and _norm(m.group(2)) not in real:
            return m.group(0)
        return fix(m)

    out = _QUOTED.sub(fix_quoted, text)
    # Only capitalised runs that are not a real button's words; a sentence that
    # merely starts a clause ("Use Chapter 2 as…") is left alone unless it ends
    # in "button".
    def fix_titled(m: re.Match) -> str:
        name = m.group(2).strip()
        if _norm(name) in real:
            return f'{m.group(1)} "{real[_norm(name)]}"'
        if m.group(3) or m.group(1).lower().split()[0] in ("press", "click", "tap", "hit"):
            return fix(m)
        return m.group(0)

    return _TITLED.sub(fix_titled, out)
