"""Audit findings — structured-critique LLM helpers.

Used by /api/audit-findings (produces a list of actionable findings the user
can apply) and /api/apply-audit (revises the output to address selected
findings). Both endpoints live in routers/audit.py.
"""

from __future__ import annotations

import logging
import uuid

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import AuditFinding, Iteration, PMInput
from .session_context import format_session_history
from .project_context import context_block

logger = logging.getLogger(__name__)


AUDIT_FINDINGS_SYSTEM = (
    "You are the audit layer of PromptMaster, operating in Cold Critic mode. "
    "Your job is to identify the most impactful, specific, actionable improvements "
    "to an AI-generated answer. You are blunt but fair. No sugarcoating. No "
    "praise. Each finding must be concrete enough that the user can act on it.\n\n"
    "Surface only the 3-7 most impactful findings. Fewer if there genuinely are no "
    "more meaningful issues. Each finding has:\n"
    "- id: unique short string (e.g., 'f1', 'f2')\n"
    "- category: short tag like 'Coverage', 'Clarity', 'Tone', 'Logic gap', 'Specificity'\n"
    "- summary: one short sentence describing what's wrong\n"
    "- suggested_change: one short sentence describing what to do about it\n\n"
    "Return JSON only with shape: { \"findings\": [ ... ] }."
)


def build_audit_findings_prompt(
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompts for the audit-findings LLM call."""
    system = AUDIT_FINDINGS_SYSTEM
    history = format_session_history(iterations)
    user = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        + (f"{context_block(inputs)}\n\n" if (inputs.context.strip() or inputs.facts) else "")
        + f"Session history:\n{history}\n\n"
        f"--- CURRENT OUTPUT TO AUDIT ---\n{current_output}\n--- END ---\n\n"
        "Identify the 3-7 most impactful findings. Return JSON in this shape:\n"
        "{\n"
        '  "findings": [\n'
        '    {"id": "f1", "category": "...", "summary": "...", "suggested_change": "..."},\n'
        "    ...\n"
        "  ]\n"
        "}"
    )
    return system, user


async def generate_audit_findings(
    client: OpenRouterClient,
    model: str | None,
    inputs: PMInput,
    current_output: str,
    iterations: list[Iteration],
) -> list[AuditFinding]:
    """Run the audit-findings LLM call. Returns parsed findings (defensive)."""
    system, user = build_audit_findings_prompt(inputs, current_output, iterations)
    try:
        result, _usage = await client.generate_json(
            prompt=user,
            system=system,
            temperature=0.2,
            max_tokens=1024,
            model=model,
        )
    except Exception as e:
        logger.warning(f"Audit findings LLM call failed: {e}")
        return []

    raw_list = result.get("findings")
    if not isinstance(raw_list, list):
        return []

    findings: list[AuditFinding] = []
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        raw = dict(raw)
        # Ensure ID is present — fall back to a generated one if the LLM omitted it
        if not raw.get("id"):
            raw["id"] = f"f{uuid.uuid4().hex[:6]}"
        try:
            findings.append(AuditFinding(**raw))
        except Exception as parse_err:
            logger.warning(f"Skipping malformed audit finding: {parse_err}")
    return findings


_APPLY_AUDIT_INSTRUCTION = (
    "APPLY-AUDIT MODE: The user audited the previous output and selected specific "
    "findings to address. Produce a revised version of the answer that addresses "
    "each finding listed below, while preserving alignment with the original "
    "objective and constraints. Keep the structure and length appropriate to the "
    "objective. Output only the revised answer text."
)


def _format_findings_block(findings: list[AuditFinding]) -> str:
    if not findings:
        return "(no findings selected)"
    lines = []
    for f in findings:
        lines.append(f"- [{f.category}] {f.summary} → {f.suggested_change}")
    return "\n".join(lines)


def build_apply_audit_prompt(
    inputs: PMInput,
    source_iteration: Iteration,
    findings: list[AuditFinding],
    iterations: list[Iteration],
) -> tuple[str, str]:
    """Build (system, user) prompts for the apply-audit LLM call."""
    system = _shared_system(inputs, iterations, _APPLY_AUDIT_INSTRUCTION)
    findings_block = _format_findings_block(findings)
    user = (
        f"Original objective: {inputs.objective}\n"
        f"Audience: {inputs.audience}\n"
        f"Constraints: {inputs.constraints or '(none)'}\n"
        f"Output format: {inputs.output_format or '(none)'}\n\n"
        + (f"{context_block(inputs)}\n\n" if (inputs.context.strip() or inputs.facts) else "")
        + f"PREVIOUS OUTPUT (revise this — do not repeat verbatim):\n"
        f"{source_iteration.output}\n\n"
        f"FINDINGS TO ADDRESS:\n{findings_block}\n\n"
        "Produce a revised version of the answer that addresses each finding "
        "while preserving alignment with the original objective. Output only "
        "the revised answer text."
    )
    return system, user
