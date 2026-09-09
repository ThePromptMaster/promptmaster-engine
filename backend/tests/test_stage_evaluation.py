"""Stage-aware evaluation — the FR-11 and FR-12 acceptance tests.

FR-11's acceptance criterion, in the contract's own words: *"Defined test
artifacts with intentional defects trigger relevant findings."* That is tested
here in two halves, neither of which calls a model:

- the **pure builder**, for what reaches the prompt — the defect is in the
  fixture artifact, and the assertion is that the axis it offends is put in
  front of the evaluator under a heading naming it;
- the **parse layer**, for what comes back — a response carrying findings about
  those defects survives into `EvaluationResult.findings` and the
  recommendation.

FR-12's criterion is that drift is compared against *"the objective, audience,
constraints, approved outline, and current stage"*. All five are asserted to
reach the assembled prompt. That axis set is the requirement an earlier design
of this feature missed, so it gets its own explicit test rather than being
inferred from a passing end-to-end.
"""

from __future__ import annotations


from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from main import app
from promptmaster.schemas import (
    OutlineSection,
    PMInput,
    StageDescriptor,
    StageDigest,
    StageDigestEntry,
    StageExitCriterion,
)
from promptmaster.stage_evaluation import (
    DRIFT_AXES,
    _parse_findings,
    _parse_recommendation,
    build_stage_evaluation_prompt,
    evaluate_stage_artifact,
    parse_stage_evaluation,
)


# --- fixtures ---------------------------------------------------------------


@pytest.fixture
def book_inputs() -> PMInput:
    return PMInput(
        objective="Write a field guide to governing AI-assisted engineering work.",
        audience="Engineering managers at companies of 50-500 people",
        constraints="No vendor names. Nothing longer than 240 pages.",
        output_format="Chapters with numbered sections",
        mode="architect",
    )


@pytest.fixture
def positioning_stage() -> StageDescriptor:
    return StageDescriptor(
        id="positioning",
        label="Positioning",
        renderer="prose",
        entry_prompt_hint=(
            "Name the books this sits beside and say what it does that they do not."
        ),
        artifact_kind="positioning_statement",
        exit_criteria=[
            StageExitCriterion(
                id="pos.rivals", label="Names at least two comparable books", blocking=True
            ),
            StageExitCriterion(id="pos.gap", label="States the gap this one fills"),
        ],
    )


@pytest.fixture
def book_digest() -> StageDigest:
    return StageDigest(
        objective="Write a field guide to governing AI-assisted engineering work.",
        audience="Engineering managers at companies of 50-500 people",
        prior_stages=[
            StageDigestEntry(
                stage_id="objective",
                label="Objective and purpose",
                summary="A practical guide, not a survey of the literature.",
            ),
        ],
    )


@pytest.fixture
def approved_outline() -> list[OutlineSection]:
    return [
        OutlineSection(id="s1", title="Why governance fails", abstract="The usual failure modes."),
        OutlineSection(id="s2", title="Review as a control", abstract="What review can carry."),
        OutlineSection(id="s3", title="Measuring the work", abstract="What to count, what not to."),
    ]


# --- the deliberately defective artifacts -----------------------------------
#
# Three artifacts, three intentional defects, one per axis a stage evaluation
# is supposed to catch. They are the "defined test artifacts" FR-11 asks for.

OFF_OBJECTIVE = """# Positioning

This book is a comprehensive survey of the academic literature on organisational
theory from 1954 onward, with extended treatment of the Carnegie School. It is
written for doctoral candidates preparing for comprehensive examinations, and
assumes familiarity with the bounded-rationality debates.

Recommended tooling: Acme CoPilot Enterprise and the Initech review suite.
"""

CONTRADICTS_OUTLINE = """# Positioning

Chapter one covers prompt engineering syntax. Chapter two covers vendor
selection. Chapter three covers procurement contracts.

Nothing here addresses why governance fails, what review can carry, or what to
measure — the three sections the approved outline commits to.
"""

WALL_OF_TEXT = (
    "positioning is important and there are other books and this one is different "
    "because it is practical and managers will like it and it covers governance "
    "and also review and also measurement and it is not too long and it does not "
    "mention vendors much and the main thing is that it is useful for people who "
    "need to govern work "
) * 4


# --- FR-12: all five comparison axes reach the prompt -----------------------


def test_all_five_drift_axes_reach_the_prompt(
    book_inputs, positioning_stage, book_digest, approved_outline
):
    """FR-12 verbatim: objective, audience, constraints, approved outline, stage.

    The requirement is a set of five, and the failure mode it guards against is
    an axis quietly going missing — which is exactly what the module docstring
    says happened to an earlier design. So each axis is asserted by its own
    content, not by counting headings.
    """
    _system, user = build_stage_evaluation_prompt(
        inputs=book_inputs,
        stage=positioning_stage,
        content=OFF_OBJECTIVE,
        digest=book_digest,
        approved_outline=approved_outline,
    )

    # 1. objective
    assert "field guide to governing AI-assisted engineering work" in user
    # 2. audience
    assert "Engineering managers at companies of 50-500 people" in user
    # 3. constraints
    assert "No vendor names" in user
    assert "Nothing longer than 240 pages" in user
    # 4. approved outline — every section, not just the first
    assert "Why governance fails" in user
    assert "Review as a control" in user
    assert "Measuring the work" in user
    # 5. current stage
    assert "Positioning" in user

    # And each axis is labelled as an axis, so the model is told what the
    # comparison set is rather than being left to infer it from context.
    for axis in DRIFT_AXES:
        assert axis.upper() in user, f"FR-12 axis '{axis}' is not labelled in the prompt"


def test_missing_outline_is_stated_not_dropped(book_inputs, positioning_stage, book_digest):
    """An absent axis must be visibly absent.

    A silently omitted outline heading is indistinguishable from a prompt that
    forgot the axis, which is the bug this module was written to fix.
    """
    _system, user = build_stage_evaluation_prompt(
        inputs=book_inputs,
        stage=positioning_stage,
        content=OFF_OBJECTIVE,
        digest=book_digest,
        approved_outline=None,
    )
    assert "APPROVED OUTLINE" in user
    assert "no outline has been approved" in user


def test_drift_polarity_is_stated(book_inputs, positioning_stage, book_digest):
    """Drift is inverted, and the evaluator has to be told so explicitly."""
    system, _user = build_stage_evaluation_prompt(
        inputs=book_inputs, stage=positioning_stage, content="x", digest=book_digest
    )
    assert "INVERTED" in system
    assert "'Low' means focused" in system


# --- FR-11: the bar is the stage, not the objective -------------------------


def test_stage_intent_is_the_evaluation_target(
    book_inputs, positioning_stage, book_digest
):
    """The stage's instruction and acceptance criteria are stated as the bar.

    This is the whole difference from `evaluate_output`, which scores against
    `inputs.objective` and never sees either.
    """
    _system, user = build_stage_evaluation_prompt(
        inputs=book_inputs,
        stage=positioning_stage,
        content=OFF_OBJECTIVE,
        digest=book_digest,
    )

    assert "Name the books this sits beside" in user
    assert "Names at least two comparable books" in user
    assert "States the gap this one fills" in user
    # The required criterion is marked as required.
    assert "Names at least two comparable books [required]" in user
    # And the bar is named as the bar.
    assert "WHAT THIS STAGE WAS ASKED TO PRODUCE" in user


def test_builder_is_pure_and_uses_the_shared_system_seam(
    book_inputs, positioning_stage, book_digest
):
    """Built on `_shared_system`, so mode locking and history come for free."""
    system, _user = build_stage_evaluation_prompt(
        inputs=book_inputs, stage=positioning_stage, content="x", digest=book_digest
    )
    assert "PromptMaster Engine" in system
    assert "Session history:" in system
    assert "STAGE EVALUATION MODE" in system


def test_defective_artifacts_reach_the_prompt_intact(
    book_inputs, positioning_stage, book_digest, approved_outline
):
    """Each defective artifact is put in front of the evaluator verbatim.

    A truncating or reformatting builder would make the FR-11 acceptance test
    unfalsifiable — the defect has to survive into the prompt for a finding
    about it to mean anything.
    """
    for artifact, tell in (
        (OFF_OBJECTIVE, "doctoral candidates"),          # off-objective, off-audience
        (CONTRADICTS_OUTLINE, "procurement contracts"),  # contradicts the outline
        (WALL_OF_TEXT, "positioning is important"),      # unstructured wall
    ):
        _system, user = build_stage_evaluation_prompt(
            inputs=book_inputs,
            stage=positioning_stage,
            content=artifact,
            digest=book_digest,
            approved_outline=approved_outline,
        )
        assert tell in user
        assert "BEGIN STAGE ARTIFACT UNDER EVALUATION" in user


def test_empty_artifact_is_labelled_rather_than_blank(
    book_inputs, positioning_stage, book_digest
):
    _system, user = build_stage_evaluation_prompt(
        inputs=book_inputs, stage=positioning_stage, content="   ", digest=book_digest
    )
    assert "this stage's artifact is empty" in user


# --- FR-11: the parse layer, for what comes back ----------------------------


def _defect_response() -> dict:
    """What a competent evaluator returns for the three defective artifacts.

    One finding per intentional defect, categorised by the axis it offends.
    """
    return {
        "alignment": {"score": "Low", "explanation": "It does not position the book at all."},
        "drift": {"score": "High", "explanation": "Drifts on objective, audience and the outline."},
        "clarity": {"score": "Low", "explanation": "One undifferentiated paragraph."},
        "completeness": {"status": "incomplete", "reason": "No comparable books are named."},
        "interpretation": {
            "label": "What to improve",
            "bullets": ["Off the objective.", "No structure.", "Ignores the outline."],
        },
        "findings": [
            {
                "id": "f1",
                "category": "objective",
                "summary": "Surveys the academic literature instead of positioning the book.",
                "suggested_change": "Name two comparable practitioner books and the gap.",
            },
            {
                "id": "f2",
                "category": "audience",
                "summary": "Addresses doctoral candidates, not engineering managers.",
                "suggested_change": "Rewrite for a manager who has to act on it this quarter.",
            },
            {
                "id": "f3",
                "category": "constraints",
                "summary": "Names two vendors, which the constraints forbid.",
                "suggested_change": "Remove the vendor names.",
            },
            {
                "id": "f4",
                "category": "approved outline",
                "summary": "Promises chapters the approved outline does not contain.",
                "suggested_change": "Align the chapter list with the three approved sections.",
            },
            {
                "id": "f5",
                "category": "structure",
                "summary": "A single unbroken paragraph with no sections.",
                "suggested_change": "Break into the sections the stage's criteria imply.",
            },
        ],
        "recommendation": {
            "id": "r1",
            "title": "Rewrite the positioning against the approved outline",
            "triggering_issue": "Alignment Low and drift High across three axes.",
            "expected_benefit": "A positioning statement the drafting stages can be judged against.",
            "scope": "The positioning stage only.",
            "instruction": "Rewrite naming two comparable books, no vendors, for managers.",
        },
    }


def test_defects_trigger_relevant_findings():
    """FR-11 acceptance: intentional defects trigger relevant findings.

    The parse layer is what decides whether a finding survives to the user, so
    this asserts the whole set arrives, keeps its category, and lands on
    `EvaluationResult.findings` — the field that is written to the pre-carved
    `evaluations.findings` column.
    """
    result = parse_stage_evaluation(_defect_response())

    categories = {f.category for f in result.evaluation.findings}
    assert {"objective", "audience", "constraints", "approved outline", "structure"} <= categories
    assert len(result.evaluation.findings) == 5

    outline_finding = next(f for f in result.evaluation.findings if f.category == "approved outline")
    assert "approved outline does not contain" in outline_finding.summary
    assert outline_finding.suggested_change

    # FR-11: a rating, an explanation, and a corrective recommendation.
    assert result.evaluation.alignment.score == "Low"
    assert result.evaluation.drift.score == "High"
    assert result.evaluation.needs_realignment is True
    assert result.recommendation is not None
    assert result.recommendation.title.startswith("Rewrite the positioning")
    # FR-14's rationale fields survive, so M4.2 has something to render.
    assert result.recommendation.triggering_issue
    assert result.recommendation.expected_benefit
    assert result.recommendation.scope


def test_clean_artifact_yields_no_findings_and_no_recommendation():
    """'When warranted' cuts both ways — a clean artifact must return null."""
    result = parse_stage_evaluation(
        {
            "alignment": {"score": "High", "explanation": "On the stage's brief."},
            "drift": {"score": "Low", "explanation": "Stays inside all five axes."},
            "clarity": {"score": "High", "explanation": "Three tight paragraphs."},
            "completeness": {"status": "complete", "reason": ""},
            "findings": [],
            "recommendation": None,
        }
    )
    assert result.evaluation.findings == []
    assert result.recommendation is None
    assert result.evaluation.needs_realignment is False


def test_malformed_rows_are_skipped_not_fatal():
    """The audit_findings idiom: half a findings list beats an exception."""
    findings = _parse_findings(
        [
            {"id": "f1", "category": "objective", "summary": "s", "suggested_change": "c"},
            "not a dict",
            {"category": "clarity"},  # missing required fields — dropped
            {"category": "audience", "summary": "s2", "suggested_change": "c2"},  # id backfilled
        ]
    )
    assert [f.category for f in findings] == ["objective", "audience"]
    assert findings[1].id and findings[1].id.startswith("f")


def test_findings_are_not_a_list_degrades_to_empty():
    assert _parse_findings({"findings": "oops"}) == []
    assert _parse_findings(None) == []


def test_recommendation_without_a_title_is_dropped():
    """A titleless recommendation cannot be rendered or acted on."""
    assert _parse_recommendation({"id": "r1", "title": "  "}) is None
    assert _parse_recommendation("not a dict") is None
    backfilled = _parse_recommendation({"title": "Do the thing"})
    assert backfilled is not None and backfilled.id.startswith("r")


def test_missing_scores_default_rather_than_raise():
    result = parse_stage_evaluation({})
    assert result.evaluation.alignment.score == "Medium"
    assert result.evaluation.findings == []
    assert result.recommendation is None


# --- the runner and the endpoint --------------------------------------------


@pytest.mark.asyncio
async def test_evaluate_stage_artifact_makes_exactly_one_call(
    book_inputs, positioning_stage, book_digest, approved_outline
):
    """One call is the product decision, not an implementation detail."""
    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(_defect_response(), {}))

    result = await evaluate_stage_artifact(
        client=client,
        inputs=book_inputs,
        stage=positioning_stage,
        content=OFF_OBJECTIVE,
        digest=book_digest,
        approved_outline=approved_outline,
    )

    assert client.generate_json.await_count == 1
    assert len(result.evaluation.findings) == 5
    # It really did send the assembled prompt, not a paraphrase of it.
    sent = client.generate_json.await_args.kwargs["prompt"]
    assert "APPROVED OUTLINE" in sent and "doctoral candidates" in sent


@pytest.mark.asyncio
async def test_llm_failure_returns_a_renderable_result(
    book_inputs, positioning_stage, book_digest
):
    client = AsyncMock()
    client.generate_json = AsyncMock(side_effect=RuntimeError("upstream is down"))

    result = await evaluate_stage_artifact(
        client=client,
        inputs=book_inputs,
        stage=positioning_stage,
        content=OFF_OBJECTIVE,
        digest=book_digest,
    )

    assert result.evaluation.alignment.score == "Medium"
    assert "upstream is down" in result.evaluation.alignment.explanation
    assert result.recommendation is None


def test_endpoint_returns_findings_and_a_recommendation(monkeypatch):
    """The route is a thin shell — it holds no prompt text and no parsing."""
    from deps import get_client

    client = AsyncMock()
    client.generate_json = AsyncMock(return_value=(_defect_response(), {}))
    app.dependency_overrides[get_client] = lambda: client
    try:
        http = TestClient(app, raise_server_exceptions=False)
        response = http.post(
                "/api/evaluate-stage-artifact",
                json={
                    "inputs": {
                        "objective": "Write a field guide.",
                        "audience": "Engineering managers",
                        "constraints": "No vendor names.",
                        "mode": "architect",
                    },
                    "stage": {
                        "id": "positioning",
                        "label": "Positioning",
                        "renderer": "prose",
                        "entry_prompt_hint": "Name the books this sits beside.",
                        "exit_criteria": [
                            {"id": "pos.rivals", "label": "Names two comparable books",
                             "blocking": True}
                        ],
                    },
                    "content": OFF_OBJECTIVE,
                    "digest": {"objective": "Write a field guide.", "audience": "Managers"},
                    "approved_outline": [
                        {"id": "s1", "title": "Why governance fails", "abstract": "Failure modes."}
                    ],
                },
            )
    finally:
        app.dependency_overrides.pop(get_client, None)

    assert response.status_code == 200
    body = response.json()
    assert len(body["evaluation"]["findings"]) == 5
    # `needs_realignment` is a Python property, not a serialised field — the
    # client derives it the same way, from a generated column on `evaluations`.
    assert body["evaluation"]["alignment"]["score"] == "Low"
    assert body["evaluation"]["drift"]["score"] == "High"
    assert body["recommendation"]["title"].startswith("Rewrite the positioning")


def test_endpoint_is_authenticated():
    """Auth is applied at router-include time; this asserts it actually is."""
    from auth import require_user

    app.dependency_overrides.pop(require_user, None)
    http = TestClient(app, raise_server_exceptions=False)
    response = http.post("/api/evaluate-stage-artifact", json={})
    assert response.status_code in (401, 403)
