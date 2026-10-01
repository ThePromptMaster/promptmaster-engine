"""Critique intensity and communication tone — two separate dials (PM-21).

Sean, Sep 10: "Tone and rigor should be separable: strong critique does not
always need harsh wording; user should be able to choose critique intensity /
communication tone."

They were welded together. Challenge Mode ended "Be blunt and specific", so the
only way to get a rigorous critique was to be spoken to harshly, and the only
way to be spoken to kindly was to get a weaker one. Here they are two blocks of
prompt text with a rule between them:

- **Intensity** decides WHAT is found: how hard to look, how high the bar is,
  how many findings. It says nothing about wording.
- **Tone** decides HOW it is said. It never changes a score, adds a finding or
  drops one.

tests/test_critique_style.py asserts the separation on the text itself: no
intensity block mentions wording, no tone block mentions what to find.
"""

from __future__ import annotations

from typing import Literal

Intensity = Literal["light", "standard", "rigorous"]
Tone = Literal["gentle", "neutral", "direct"]

#: Findings the stage evaluator may raise at each intensity.
MAX_FINDINGS: dict[str, int] = {"light": 3, "standard": 7, "rigorous": 10}

INTENSITY_RULES: dict[str, str] = {
    "light": (
        "LIGHT. Raise only problems that would materially mislead the reader or "
        "fail what was asked for. Let minor and stylistic points go. At most "
        f"{MAX_FINDINGS['light']} findings."
    ),
    "standard": (
        "STANDARD. Raise the concrete defects a careful expert reviewer in this field would "
        f"raise. At most {MAX_FINDINGS['standard']} findings."
    ),
    "rigorous": (
        "RIGOROUS. Examine it as a demanding expert reviewer would: test every "
        "claim for support, every number for consistency, every step of an "
        "argument for gaps, every assumption for whether it holds. Minor defects "
        f"count. At most {MAX_FINDINGS['rigorous']} findings."
    ),
}

TONE_RULES: dict[str, str] = {
    "gentle": (
        "GENTLE. Open with what works. Put each problem constructively, as what "
        "to do next, in warm, encouraging wording. Never sarcastic."
    ),
    "neutral": "NEUTRAL. Plain, professional, matter-of-fact wording.",
    "direct": (
        "DIRECT. Blunt and brief. No softening, no praise to pad the problems. "
        "State each problem plainly."
    ),
}

SEPARATION_RULE = (
    "These two settings are independent. Intensity decides WHAT you find and how "
    "hard you look; tone decides only HOW you word it. A gentle tone never softens "
    "a score, hides a finding or lowers the bar. A direct tone never adds a "
    "finding or lowers a score."
)


def intensity_of(value: str | None) -> str:
    return value if value in INTENSITY_RULES else "standard"


def tone_of(value: str | None) -> str:
    return value if value in TONE_RULES else "neutral"


def critique_style_block(intensity: str | None, tone: str | None) -> str:
    """The two dials as prompt text, with the rule that keeps them apart. Pure."""
    return (
        f"CRITIQUE INTENSITY — {INTENSITY_RULES[intensity_of(intensity)]}\n"
        f"COMMUNICATION TONE — {TONE_RULES[tone_of(tone)]}\n"
        f"{SEPARATION_RULE}"
    )
