"""Stage-aware evaluation — FR-11 and FR-12.

Why this module exists rather than a flag on `evaluator.py`
-----------------------------------------------------------
`evaluate_output` scores an answer against `inputs.objective` and nothing else.
FR-12 is explicit that drift is "compared against the objective, audience,
constraints, approved outline, and current stage" — five axes, of which the
existing evaluator sees two and a half. A stage artifact judged against the
project objective alone is judged against the wrong thing: an Audience stage
producing four reader segments is not *supposed* to answer the objective, it is
supposed to answer the stage.

So the evaluation target here is **the stage's declared intent**. Its
`entry_prompt_hint` says what the artifact was meant to be and its
`exit_criteria` say what would make it acceptable; the project objective is one
of five things drift is measured against, not the bar itself.

The shape of the call
---------------------
One LLM call returns scores AND findings AND a corrective recommendation. FR-11
requires each result to carry "a rating or score, concise explanation,
associated artifact/version, and corrective recommendation when warranted" —
splitting that across three calls would triple the cost of a control the user
presses deliberately. `build_iteration_with_full_pipeline` is not used for the
same reason `generate-stage-artifact` does not use it.

Prompt building is pure and separate from the call, so what reaches the model
can be asserted without a model — see tests/test_stage_evaluation.py. That is
the one thing `evaluator.py` never had, and the reason its prompt is untested.
"""

from __future__ import annotations

import logging
import uuid

from .conversation import _shared_system
from .llm_client import OpenRouterClient
from .schemas import (
    AuditFinding,
    CompletenessResult,
    DimensionScore,
    EvaluationResult,
    Iteration,
    OutlineSection,
    PMInput,
    StageDescriptor,
    StageDigest,
    StageEvaluationResponse,
    StageRecommendation,
    WhyThisWorks,
)

logger = logging.getLogger(__name__)


# The five axes FR-12 names, in the contract's own order. Named once, used both
# in the instruction and in the finding-category vocabulary, so the prompt
# cannot drift from the requirement by editing one and not the other.
DRIFT_AXES: tuple[str, ...] = (
    "objective",
    "audience",
    "constraints",
    "approved outline",
    "current stage",
)


_STAGE_EVAL_INSTRUCTION = (
    "STAGE EVALUATION MODE: You are the evaluation layer of PromptMaster, "
    "assessing ONE stage's artifact from a longer piece of structured work. You "
    "are not writing or revising anything — you are judging what is in front of "
    "you and saying what to do about it.\n\n"
    "WHAT YOU ARE JUDGING AGAINST. The bar is THIS STAGE'S declared intent: the "
    "stage instruction and the stage's acceptance criteria, both given below. "
    "An artifact that answers the project objective beautifully but does not do "
    "what this stage asked for has FAILED, and you must say so. Equally, do not "
    "penalise an artifact for omitting work that belongs to a later stage.\n\n"
    "DRIFT is measured against five things, and only these five:\n"
    + "\n".join(f"  {i + 1}. the {axis}" for i, axis in enumerate(DRIFT_AXES))
    + "\n"
    "Drift has INVERTED polarity: 'Low' means focused and on-target, which is "
    "GOOD; 'High' means it has wandered. Check each of the five axes in turn "
    "before you score drift, and raise a finding for every axis it deviates on.\n\n"
    "FINDINGS are the specific defects you found. Each one must be concrete "
    "enough to act on — 'could be clearer' is not a finding, 'section 3 asserts "
    "a launch date the constraints rule out' is. Raise between 0 and 7. An "
    "artifact with nothing wrong with it gets an empty list; do not manufacture "
    "findings to look rigorous.\n\n"
    "RECOMMENDATION: when a threshold is crossed — alignment Low, drift High, "
    "or a finding serious enough to be worth a revision — return ONE corrective "
    "recommendation. It is offered to the user, never applied: they may accept, "
    "modify, reject, or carry on without it. When nothing warrants one, return "
    "null.\n\n"
    "You are fair but rigorous. You do not inflate scores and you do not "
    "manufacture problems. Return ONLY valid JSON, no other text."
)


_RESPONSE_SHAPE = """{
  "alignment": {"score": "Low|Medium|High", "explanation": "one sentence"},
  "drift": {"score": "Low|Medium|High", "explanation": "one sentence naming the axis or axes it drifted on"},
  "clarity": {"score": "Low|Medium|High", "explanation": "one sentence"},
  "completeness": {"status": "complete|incomplete", "reason": "one short sentence (empty string if complete)"},
  "interpretation": {"label": "Why this works|What to improve", "bullets": ["...", "...", "..."]},
  "findings": [
    {"id": "f1", "category": "...", "summary": "one line — what is wrong", "suggested_change": "one line — what to do"}
  ],
  "recommendation": {
    "id": "r1",
    "title": "one line — the corrective action",
    "triggering_issue": "what went wrong that prompts this",
    "expected_benefit": "what applying it would fix",
    "scope": "what it would touch",
    "instruction": "the revision instruction, ready to hand to the model"
  }
}"""


def _format_exit_criteria(stage: StageDescriptor) -> str:
    """The stage's own definition of acceptable, told to the evaluator.

    Not a gate: the engine still decides transitions with pure predicates. This
    is the standard the artifact was written to, which is the thing a judge has
    to be told.
    """
    if not stage.exit_criteria:
        return "(this stage declares no explicit acceptance criteria)"
    lines = []
    for criterion in stage.exit_criteria:
        label = (criterion.label or criterion.id).strip()
        if not label:
            continue
        lines.append(f"- {label}" + (" [required]" if criterion.blocking else ""))
    return "\n".join(lines) or "(this stage declares no explicit acceptance criteria)"


def _format_outline(approved_outline: list[OutlineSection] | None) -> str:
    """The approved outline, one of FR-12's five axes.

    A project with no approved outline says so in words rather than dropping
    the axis, because a silently absent axis is indistinguishable from an axis
    the prompt forgot — and that is precisely the bug this module exists to
    fix.
    """
    if not approved_outline:
        return "(no outline has been approved for this project)"
    lines = []
    for index, section in enumerate(approved_outline, start=1):
        title = section.title.strip() or f"Section {index}"
        abstract = section.abstract.strip()
        lines.append(f"{index}. {title}" + (f" — {abstract}" if abstract else ""))
    return "\n".join(lines)


def _format_prior_stages(digest: StageDigest) -> str:
    if not digest.prior_stages:
        return "(nothing completed before this stage)"
    lines = []
    for entry in digest.prior_stages:
        label = entry.label or entry.stage_id
        summary = entry.summary.strip() or "(no summary recorded)"
        lines.append(f"- {label}: {summary}")
    return "\n".join(lines)


def build_stage_evaluation_prompt(
    inputs: PMInput,
    stage: StageDescriptor,
    content: str,
    digest: StageDigest,
    approved_outline: list[OutlineSection] | None = None,
    iterations: list[Iteration] | None = None,
) -> tuple[str, str]:
    """Build (system, user) prompts for one stage artifact's evaluation.

    Pure: no I/O, no model. All five FR-12 comparison axes reach the user
    prompt under headings that name them, and the stage's intent — its
    instruction and its acceptance criteria — is stated as the bar.
    """
    system = _shared_system(inputs, iterations or [], _STAGE_EVAL_INSTRUCTION)

    stage_label = stage.label or stage.id
    hint = stage.entry_prompt_hint.strip() or "(this stage declares no instruction)"

    parts = [
        "Evaluate the stage artifact below.",
        "",
        "=== THE BAR: WHAT THIS STAGE WAS ASKED TO PRODUCE ===",
        f"CURRENT STAGE: {stage_label}",
        f"Artifact kind: {stage.artifact_kind or '(unspecified)'}",
        f"Stage instruction:\n{hint}",
        f"Acceptance criteria for this stage:\n{_format_exit_criteria(stage)}",
        "",
        "=== THE FIVE THINGS DRIFT IS MEASURED AGAINST (FR-12) ===",
        f"1. OBJECTIVE: {digest.objective or inputs.objective or '(none stated)'}",
        f"2. AUDIENCE: {digest.audience or inputs.audience or '(none stated)'}",
        f"3. CONSTRAINTS: {inputs.constraints or '(none)'}",
        f"4. APPROVED OUTLINE:\n{_format_outline(approved_outline)}",
        f"5. CURRENT STAGE: {stage_label} — see the stage instruction above.",
        "",
        f"Requested output format: {inputs.output_format or '(none)'}",
        "",
        f"WHAT THE EARLIER STAGES ESTABLISHED:\n{_format_prior_stages(digest)}",
        "",
        "--- BEGIN STAGE ARTIFACT UNDER EVALUATION ---",
        content.strip() or "(this stage's artifact is empty)",
        "--- END STAGE ARTIFACT ---",
        "",
        "Score alignment, drift and clarity as Low/Medium/High with one sentence "
        "each; judge completeness; give 3-4 plain-English interpretation bullets; "
        "list the concrete findings; and return one corrective recommendation if a "
        "threshold was crossed, otherwise null.",
        "",
        "Categorise each finding by the axis or property it offends. Prefer these "
        "categories where they fit: "
        + ", ".join(f"'{axis}'" for axis in DRIFT_AXES)
        + ", 'structure', 'clarity', 'completeness'.",
        "",
        "Return JSON in exactly this shape:",
        _RESPONSE_SHAPE,
    ]

    return system, "\n".join(parts)


def _parse_findings(raw_list: object) -> list[AuditFinding]:
    """Defensive parse, matching generate_audit_findings.

    A malformed row is skipped, not fatal: four usable findings and a dropped
    fifth is worth more than an exception that loses the whole evaluation the
    user just paid for. Missing ids are backfilled so the client has a stable
    key and a selection target.
    """
    if not isinstance(raw_list, list):
        return []

    findings: list[AuditFinding] = []
    for raw in raw_list:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        if not row.get("id"):
            row["id"] = f"f{uuid.uuid4().hex[:6]}"
        try:
            findings.append(AuditFinding(**row))
        except Exception as parse_err:
            logger.warning(f"Skipping malformed stage evaluation finding: {parse_err}")
    return findings


def _parse_recommendation(raw: object) -> StageRecommendation | None:
    """A recommendation is optional by design — 'when warranted', says FR-11.

    `null` is the correct answer for a clean artifact, so an absent or
    unparseable recommendation degrades to None rather than to an error.
    """
    if not isinstance(raw, dict):
        return None
    row = dict(raw)
    if not row.get("id"):
        row["id"] = f"r{uuid.uuid4().hex[:6]}"
    if not str(row.get("title") or "").strip():
        return None
    try:
        return StageRecommendation(**row)
    except Exception as parse_err:
        logger.warning(f"Dropping malformed stage recommendation: {parse_err}")
        return None


def _dimension(raw: object, fallback: str) -> DimensionScore:
    if isinstance(raw, dict):
        try:
            return DimensionScore(**raw)
        except Exception as parse_err:
            logger.warning(f"Invalid dimension score, defaulting: {parse_err}")
    return DimensionScore(score="Medium", explanation=fallback)


def parse_stage_evaluation(result: dict) -> StageEvaluationResponse:
    """Turn one raw JSON response into the typed result. Pure.

    Separated from the call for the same reason the prompt builder is: the
    thing most likely to break is the shape a model returns, and that is
    testable without spending a token.
    """
    completeness: CompletenessResult | None = None
    comp_raw = result.get("completeness")
    if isinstance(comp_raw, dict):
        try:
            completeness = CompletenessResult(**comp_raw)
        except Exception as comp_err:
            logger.warning(f"Invalid completeness in stage eval, dropping: {comp_err}")

    interpretation: WhyThisWorks | None = None
    interp_raw = result.get("interpretation")
    if isinstance(interp_raw, dict):
        try:
            interpretation = WhyThisWorks(**interp_raw)
        except Exception as interp_err:
            logger.warning(f"Invalid interpretation in stage eval, dropping: {interp_err}")

    evaluation = EvaluationResult(
        alignment=_dimension(result.get("alignment"), "Unable to evaluate"),
        drift=_dimension(result.get("drift"), "Unable to evaluate"),
        clarity=_dimension(result.get("clarity"), "Unable to evaluate"),
        completeness=completeness,
        interpretation=interpretation,
        findings=_parse_findings(result.get("findings")),
    )

    return StageEvaluationResponse(
        evaluation=evaluation,
        recommendation=_parse_recommendation(result.get("recommendation")),
    )


def _failed(reason: str) -> StageEvaluationResponse:
    """A total failure still returns a shape the UI can render.

    Middle scores with the error in the explanation, rather than an exception:
    an evaluation the user asked for and paid for should not take the stage
    down with it, and 'Medium — evaluation error' is honest about what happened.
    """
    return StageEvaluationResponse(
        evaluation=EvaluationResult(
            alignment=DimensionScore(score="Medium", explanation=f"Evaluation error: {reason}"),
            drift=DimensionScore(score="Medium", explanation=f"Evaluation error: {reason}"),
            clarity=DimensionScore(score="Medium", explanation=f"Evaluation error: {reason}"),
        ),
        recommendation=None,
    )


async def evaluate_stage_artifact(
    client: OpenRouterClient,
    inputs: PMInput,
    stage: StageDescriptor,
    content: str,
    digest: StageDigest,
    approved_outline: list[OutlineSection] | None = None,
    iterations: list[Iteration] | None = None,
    model: str | None = None,
) -> StageEvaluationResponse:
    """Evaluate one stage's artifact. Exactly one LLM call."""
    system, user = build_stage_evaluation_prompt(
        inputs=inputs,
        stage=stage,
        content=content,
        digest=digest,
        approved_outline=approved_outline,
        iterations=iterations,
    )

    try:
        result, _usage = await client.generate_json(
            prompt=user,
            system=system,
            # Low, for the same reason evaluator.py runs cold: a score that
            # moves when the text did not reads to a user as a bug.
            temperature=0.15,
            max_tokens=1536,
            model=model,
        )
    except Exception as e:
        logger.error(f"Stage evaluation failed for {stage.id}: {e}")
        return _failed(str(e))

    if not isinstance(result, dict):
        logger.warning(f"Stage evaluation for {stage.id} returned a non-object")
        return _failed("malformed response")

    return parse_stage_evaluation(result)
