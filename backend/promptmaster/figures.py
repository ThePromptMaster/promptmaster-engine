"""The figures a stage established, read out of its own text.

A later stage is told about an earlier one in a few lines of summary. Numbers
do not survive that: a validation stage re-derived a result from the prose and
produced a different one (the client's 1 Oct feedback, item 32). This reads a
finished stage's figures out once, when the stage is completed, so later
stages can be handed the values to quote instead of working them out again.

One rule makes this safe to trust: **a figure is kept only if its value
appears, character for character, in the stage's text.** The model names the
figure; it cannot supply one. A value the text does not contain is dropped.
"""

from __future__ import annotations

import re

from pydantic import BaseModel, Field

from .llm_client import OpenRouterClient

MAX_FIGURES = 12


class Figure(BaseModel):
    name: str = Field(max_length=120)
    #: Exactly as the stage wrote it: "9.4%", "$1.2M", "114 of 240".
    value: str = Field(max_length=60)
    #: A few words on what it measures or covers, when the name alone is ambiguous.
    context: str = Field(default="", max_length=200)


FIGURES_SYSTEM = (
    "You read one finished piece of work and list the FIGURES it establishes: the "
    "numbers, amounts, rates, counts, dates and thresholds a later reader would "
    "need to quote correctly.\n\n"
    "Rules:\n"
    "- Copy each value EXACTLY as it is written in the text, including its unit or "
    "symbol (\"9.4%\", \"$1.2M\", \"114 of 240\", \"Q3 2025\"). Never compute, round, "
    "convert or combine values. A value that is not in the text is not a figure.\n"
    "- Give each a short name saying what it measures (\"Mid-Market churn rate, Q2\").\n"
    "- Only results, measurements, inputs and decided thresholds. Skip section "
    "numbers, list numbering, page counts and examples.\n"
    f"- At most {MAX_FIGURES}; the ones the conclusions rest on. If the text "
    "establishes no figures, return an empty list.\n\n"
    'Return JSON only: {"figures": [{"name": "...", "value": "...", "context": "..."}]}'
)


def build_figures_prompt(stage_label: str, content: str) -> tuple[str, str]:
    """Build (system, user). Pure."""
    user = "\n".join([
        f"STAGE: {stage_label or '(unnamed)'}",
        "",
        "--- THE TEXT ---",
        content.strip(),
        "--- END ---",
        "",
        "List the figures.",
    ])
    return FIGURES_SYSTEM, user


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def parse_figures(raw: object, content: str) -> list[Figure]:
    """Keep only figures whose value is in the text, exactly as given.

    This is the whole safeguard: the list becomes something later stages are
    told to quote, so a value the model computed, rounded or invented must
    not get into it. Values with no digit are dropped too — "significant" is
    not a figure.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("figures"), list):
        return []
    haystack = _squash(content)
    out: list[Figure] = []
    seen: set[tuple[str, str]] = set()
    for item in raw["figures"]:
        if len(out) >= MAX_FIGURES:
            break
        if not isinstance(item, dict):
            continue
        name = _squash(str(item.get("name") or "")).strip()
        value = _squash(str(item.get("value") or "")).strip()
        if not name or not value or not re.search(r"\d", value):
            continue
        if value not in haystack:
            continue
        key = (name.lower(), value)
        if key in seen:
            continue
        seen.add(key)
        out.append(Figure(name=name[:120], value=value[:60], context=_squash(str(item.get("context") or "")).strip()[:200]))
    return out


async def extract_figures(client: OpenRouterClient, model: str | None, stage_label: str, content: str) -> list[Figure]:
    """One small JSON call. No digits in the text: no call, no figures."""
    if not re.search(r"\d", content):
        return []
    system, user = build_figures_prompt(stage_label, content[:60_000])
    raw, _usage = await client.generate_json(prompt=user, system=system, temperature=0.0, max_tokens=1_200, model=model)
    return parse_figures(raw, content)
