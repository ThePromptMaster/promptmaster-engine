"""/api/apply-recommendations — FR-09's one-call apply path.

Two things are worth testing here and neither needs a model:

1. That it is **one** call and not the four-call iteration pipeline. The
   pipeline scores against `inputs.objective`, which is the wrong bar for a
   stage artifact and discards three results into the bargain.
2. That the combined instruction crosses the language boundary **byte
   identically**. The frontend renders the block the user approves in the
   preview dialog; the backend splices the block into the prompt. FR-15 asks
   for "the combined instruction is visible", and that claim is only true if
   those two strings are the same one. Both sides hardcode the same literal, so
   changing either alone fails.
"""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from deps import get_client
from main import app
from promptmaster.audit_findings import _format_findings_block
from promptmaster.schemas import AuditFinding
from routers import audit as audit_router_module


# The literal `frontend/src/lib/workflow/combine.test.ts` asserts against.
COMBINED_FIXTURE = (
    "- [realignment] Cut the vendor comparison → Remove every named vendor and "
    "restate the comparison in generic terms.\n"
    "- [fix] Name the audience in the opening → Say who this is for in the "
    "first paragraph."
)

# The recommendation rows, cast to the AuditFinding shape the frontend sends:
# {id: category-key, category: kind, summary: title, suggested_change: instruction}.
CAST_RECOMMENDATIONS = [
    AuditFinding(
        id="evaluation:draft:r1",
        category="realignment",
        summary="Cut the vendor comparison",
        suggested_change=(
            "Remove every named vendor and restate the comparison in generic terms."
        ),
    ),
    AuditFinding(
        id="evaluation:draft:r2",
        category="fix",
        summary="Name the audience in the opening",
        suggested_change="Say who this is for in the first paragraph.",
    ),
]


# --- FR-15: the visible instruction is the sent instruction -------------------


def test_findings_block_matches_the_frontend_literal():
    """The equality FR-15's acceptance criterion rests on, asserted without a model."""
    assert _format_findings_block(CAST_RECOMMENDATIONS) == COMBINED_FIXTURE


def test_empty_selection_matches_the_frontend_fallback():
    assert _format_findings_block([]) == "(no findings selected)"


def test_the_block_reaches_the_prompt_verbatim(basic_inputs):
    from promptmaster.audit_findings import build_apply_audit_prompt
    from promptmaster.schemas import Iteration

    _system, prompt = build_apply_audit_prompt(
        inputs=basic_inputs,
        source_iteration=Iteration(
            iteration_number=1, prompt_sent="", output="A draft.", mode=basic_inputs.mode
        ),
        findings=CAST_RECOMMENDATIONS,
        iterations=[],
    )
    # Not "contains each line" — the whole block, unbroken, exactly as shown.
    assert COMBINED_FIXTURE in prompt


# --- shape --------------------------------------------------------------------


def test_router_registers_the_endpoint():
    paths = [r.path for r in audit_router_module.router.routes]
    assert "/api/apply-recommendations" in paths


def test_request_takes_content_not_a_fabricated_iteration():
    fields = audit_router_module.ApplyRecommendationsRequest.model_fields
    for required in ("inputs", "content", "findings", "model"):
        assert required in fields, f"missing field: {required}"
    # The workspace holds ArtifactVersion rows, which have no iteration number
    # and no evaluation. Demanding one would be inventing provenance.
    assert "source_iteration" not in fields


def test_response_carries_the_instruction_for_fr10_provenance():
    fields = audit_router_module.ApplyRecommendationsResponse.model_fields
    for required in ("content", "instruction", "finish_reason"):
        assert required in fields


# --- one call, and the right prompt ------------------------------------------


def test_endpoint_reuses_the_existing_prompt_builder():
    src = inspect.getsource(audit_router_module.api_apply_recommendations)
    assert "build_apply_audit_prompt" in src


def test_endpoint_does_not_run_the_four_call_pipeline():
    src = inspect.getsource(audit_router_module.api_apply_recommendations)
    assert "build_iteration_with_full_pipeline" not in src


def test_endpoint_makes_exactly_one_llm_call(basic_inputs):
    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("A revised draft.", {}, "stop"))
    app.dependency_overrides[get_client] = lambda: client

    try:
        response = TestClient(app).post(
            "/api/apply-recommendations",
            json={
                "inputs": basic_inputs.model_dump(),
                "content": "A draft naming three vendors.",
                "findings": [f.model_dump() for f in CAST_RECOMMENDATIONS],
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "A revised draft."
    assert body["instruction"] == COMBINED_FIXTURE
    assert body["finish_reason"] == "stop"

    # The whole cost argument for this endpoint existing.
    assert client.generate_with_meta.await_count == 1
    assert client.generate_json.await_count == 0


def test_the_artifact_content_is_what_gets_revised(basic_inputs):
    client = AsyncMock()
    client.generate_with_meta = AsyncMock(return_value=("Revised.", {}, "stop"))
    app.dependency_overrides[get_client] = lambda: client

    try:
        TestClient(app).post(
            "/api/apply-recommendations",
            json={
                "inputs": basic_inputs.model_dump(),
                "content": "THE ARTIFACT AS STORED.",
                "findings": [f.model_dump() for f in CAST_RECOMMENDATIONS],
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)

    prompt = client.generate_with_meta.await_args.kwargs["prompt"]
    assert "THE ARTIFACT AS STORED." in prompt
    assert COMBINED_FIXTURE in prompt


def test_llm_failure_surfaces_as_502(basic_inputs):
    from promptmaster.llm_client import OpenRouterError

    client = AsyncMock()
    client.generate_with_meta = AsyncMock(side_effect=OpenRouterError("upstream down"))
    app.dependency_overrides[get_client] = lambda: client

    try:
        response = TestClient(app).post(
            "/api/apply-recommendations",
            json={
                "inputs": basic_inputs.model_dump(),
                "content": "A draft.",
                "findings": [f.model_dump() for f in CAST_RECOMMENDATIONS],
            },
        )
    finally:
        app.dependency_overrides.pop(get_client, None)

    assert response.status_code == 502
