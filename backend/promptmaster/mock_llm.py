"""Scripted stand-in for OpenRouterClient, for deterministic browser E2E runs.

Enabled by `PM_LLM_MODE=mock` (see deps.py) and never in production: `deps`
refuses to start in mock mode when `VERCEL_ENV=production`, and a test pins
that. The point is that Playwright can walk the real UI against the real
FastAPI routers and the real prompt builders, with only the network hop to
the provider replaced — so an E2E failure means the product is broken, not
that a model had a creative day.

Only `_request_with_retries` is overridden. `generate`, `generate_with_meta`
and `generate_json` run exactly as in production, including JSON cleaning and
the repair pass, which keeps this double honest about the parsing paths.

Which reply to give is decided by the system prompt, matched against the real
prompt constants imported from each module — so editing prompt wording cannot
silently desynchronise the mock.

Fault injection, for testing recovery paths (FR-16, PM-04): put a marker in
anything that reaches a prompt, e.g. the project objective or a section title.
  [[mock:402]]      -> out of credits (non-retryable)
  [[mock:429]]      -> rate limited
  [[mock:500]]      -> provider error
  [[mock:length]]   -> finish_reason "length" (truncated output)
  [[mock:slow=N]]   -> sleep N seconds before answering
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from promptmaster.llm_client import OpenRouterClient, OpenRouterError

MOCK_MODEL = "mock/scripted"

_MARKER = re.compile(r"\[\[mock:([a-z0-9]+)(?:=(\d+))?\]\]")


def _system_and_prompt(payload: dict[str, Any]) -> tuple[str, str]:
    system, prompt = "", ""
    for message in payload.get("messages", []):
        if message.get("role") == "system":
            system = message.get("content", "")
        elif message.get("role") == "user":
            prompt = message.get("content", "")
    return system, prompt


def _markers(text: str) -> dict[str, int | None]:
    return {m.group(1): (int(m.group(2)) if m.group(2) else None) for m in _MARKER.finditer(text)}


def _objective(prompt: str) -> str:
    match = re.search(r"Objective:\s*(.+)", prompt)
    return match.group(1).strip() if match else "the stated objective"


# --- JSON replies, one per call site ---------------------------------------


def _stage_items(prompt: str) -> dict:
    """Fill the literal item example the stage prompt carries (stage._example_json)."""
    match = re.search(r'"items": \[\s*(\{.*?\}),', prompt, re.S)
    keys = ["text"]
    if match:
        try:
            keys = [k for k in json.loads(match.group(1)) if k != "id"] or ["text"]
        except json.JSONDecodeError:
            pass
    items = []
    for n in range(1, 4):
        item: dict[str, str] = {"id": f"i{n}"}
        for key in keys:
            item[key] = "clean" if key == "status" else f"Mock {key.replace('_', ' ')} {n}"
        items.append(item)
    return {"items": items}


def _stage_evaluation() -> dict:
    return {
        "alignment": {"score": "High", "explanation": "Mock: the artifact does what this stage asked for."},
        "drift": {"score": "Low", "explanation": "Mock: no drift on any of the five axes."},
        "clarity": {"score": "High", "explanation": "Mock: plainly structured and easy to follow."},
        "completeness": {"status": "complete", "reason": ""},
        "interpretation": {
            "label": "Why this works",
            "bullets": ["Mock: matches the stage.", "Mock: clear structure.", "Mock: stays focused."],
        },
        "findings": [],
        "recommendation": None,
    }


def _legacy_evaluation() -> dict:
    evaluation = _stage_evaluation()
    evaluation.pop("findings")
    evaluation.pop("recommendation")
    return evaluation


def _setup(prompt: str) -> dict:
    return {
        "mode": "architect",
        "audience": "General",
        "constraints": "Mock constraints for: " + _objective(prompt)[:80],
        "output_format": "Free-form prose",
        "rationale": {
            "mode": "Mock: structure suits this objective.",
            "audience": "Mock: broad readership.",
            "constraints": "Mock: keeps scope tight.",
            "output_format": "Mock: prose reads naturally.",
        },
    }


def _outline(prompt: str) -> dict:
    count_match = re.search(r"Target section count:\s*(\d+)", prompt)
    count = max(2, min(int(count_match.group(1)) if count_match else 3, 6))
    return {
        "outline": [
            {"title": f"Mock section {n}", "abstract": f"Mock abstract for section {n}."}
            for n in range(1, count + 1)
        ]
    }


def _section_record() -> dict:
    return {
        "summary": "Mock summary of the section.",
        "glossary_terms": [{"term": "Mock term", "definition": "A term defined by the mock."}],
        "decisions": ["Mock decision."],
        "todos": [],
    }


def _json_reply(system: str, prompt: str) -> dict:
    # Imported here, not at module top, to avoid import cycles with modules that
    # import the client.
    from promptmaster import audit_findings, continuity, evaluator, guidance, long_form, setup_suggester
    from promptmaster.stage import _LIST_INSTRUCTION
    from promptmaster.stage_evaluation import _STAGE_EVAL_INSTRUCTION

    if _STAGE_EVAL_INSTRUCTION[:60] in system:
        return _stage_evaluation()
    if _LIST_INSTRUCTION[:60] in system:
        return _stage_items(prompt)
    if system.startswith(setup_suggester.SETUP_SUGGESTER_SYSTEM[:60]):
        return _setup(prompt)
    if system.startswith(long_form._DETECT_SYSTEM[:60]):
        return {"is_long_form": True, "suggested_section_count": 3, "reason": "Mock: multi-section."}
    if system.startswith(long_form._OUTLINE_SYSTEM[:60]):
        return _outline(prompt)
    if system.startswith(long_form._RECORD_SYSTEM[:60]):
        return _section_record()
    if system.startswith(evaluator.EVALUATOR_SYSTEM[:60]):
        return _legacy_evaluation()
    if system.startswith(audit_findings.AUDIT_FINDINGS_SYSTEM[:60]):
        return {"findings": [{"id": "f1", "category": "Clarity", "summary": "Mock finding.",
                              "suggested_change": "Mock change."}]}
    if system.startswith(continuity._SNAPSHOT_SYSTEM[:60]):
        return {"summary": "Mock snapshot.", "sections_done": [], "next": "Continue."}
    if system.startswith(guidance.GUIDANCE_SYSTEM[:60]):
        return {"suggestions": [{"text": "Mock suggestion.", "action": "Refine"}]}
    # Unknown JSON call site: an empty object. Every parser in this codebase
    # degrades on missing fields, so this surfaces as a visible default rather
    # than a crash — and a new call site should add a branch above.
    return {}


def _prose_reply(system: str, prompt: str) -> str:
    objective = _objective(prompt) if "Objective:" in prompt else "the task"
    return (
        "## Mock output\n\n"
        f"This is scripted text produced by the mock model for: {objective[:120]}.\n\n"
        "It has two paragraphs so that renderers, word counts and version history "
        "have something realistic to hold. Nothing here came from a real model."
    )


class ScriptedClient(OpenRouterClient):
    """OpenRouterClient with the network replaced by scripted replies."""

    def __init__(self) -> None:
        super().__init__(api_key="mock-key-not-used", model=MOCK_MODEL)

    async def _request_with_retries(
        self,
        payload: dict[str, Any],
        headers: dict[str, str],
        timeout: float | None,
        deadline: float | None,
    ) -> tuple[str, dict[str, int], str]:
        system, prompt = _system_and_prompt(payload)
        markers = _markers(system + "\n" + prompt)

        if "slow" in markers:
            await asyncio.sleep(markers["slow"] or 5)
        if "402" in markers:
            raise OpenRouterError(
                "OpenRouter API error 402: insufficient credits (mock)",
                status_code=402,
                provider_code="insufficient_credits",
            )
        if "429" in markers:
            raise OpenRouterError("OpenRouter API error 429: rate limited (mock)", status_code=429, retry_after=1.0)
        if "500" in markers:
            raise OpenRouterError("OpenRouter API error 500: provider error (mock)", status_code=500)

        if payload.get("response_format", {}).get("type") == "json_object":
            content = json.dumps(_json_reply(system, prompt))
        else:
            content = _prose_reply(system, prompt)

        usage = {"tokens_in": len(system + prompt) // 4, "tokens_out": len(content) // 4}
        finish_reason = "length" if "length" in markers else "stop"
        return content, usage, finish_reason

    @classmethod
    async def fetch_text_models(cls, api_key: str | None = None, timeout: float = 20.0) -> list[dict[str, Any]]:
        return [{"id": MOCK_MODEL, "name": "Mock (scripted)", "context_length": 128000}]
