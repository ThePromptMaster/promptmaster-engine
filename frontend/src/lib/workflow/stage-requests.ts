/**
 * The requests a stage's draft and evaluation send, and what is stored from
 * their responses. Pure.
 *
 * Extracted from the drafting and evaluation hooks so Go mode (B4) performs
 * `draft_stage` and `evaluate_stage` with exactly the calls the buttons make:
 * a stage the agent drafts must be indistinguishable from one the user drafted,
 * or the version history would record two kinds of "AI draft".
 */

import { buildStageDigest, type StageArtifactBundle } from '@/lib/workflow/digest';
import {
  itemSchemaFor,
  rendererHoldsItems,
  serializeItems,
  type StageItem,
} from '@/lib/workflow/stage-artifact';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewEvaluation } from '@/lib/supabase/versions';
import type { Project } from '@/types/project';
import type {
  EvaluateStageArtifactRequest,
  EvaluateStageArtifactResponse,
  GenerateStageArtifactRequest,
  GenerateStageArtifactResponse,
  OutlineSection,
  PMInput,
} from '@/types';

/**
 * The project's setup fields as the PMInput every backend call expects.
 *
 * One assembly for every call: applying a recommendation and evaluating an
 * artifact must present the model with the same objective, audience and
 * constraints, or the correction is written against a different brief than
 * the one it was judged against.
 */
export function inputsFrom(project: Project): PMInput {
  return {
    objective: project.objective,
    audience: project.audience,
    constraints: project.constraints,
    output_format: project.output_format,
    mode: project.mode,
    custom_name: project.custom_name,
    custom_preamble: project.custom_preamble,
    custom_tone: project.custom_tone,
    session_facts: project.session_facts,
    critique_intensity: project.critique_intensity ?? 'standard',
    critique_tone: project.critique_tone ?? 'neutral',
  };
}

export function generationRequest(
  project: Project,
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  target: StageDefinition,
  existingContent: string,
  instruction = ''
): GenerateStageArtifactRequest {
  const schema = itemSchemaFor(target);
  return {
    inputs: inputsFrom(project),
    stage: {
      id: target.id,
      label: target.label,
      renderer: target.renderer,
      entry_prompt_hint: target.entry_prompt_hint ?? '',
      artifact_kind: target.expected_artifacts[0]?.kind ?? '',
    },
    digest: buildStageDigest(template, state, project, bundles, target.id),
    item_schema: rendererHoldsItems(target.renderer)
      ? {
          item_label: schema.itemLabel,
          fields: schema.fields.filter((f) => !f.userOnly).map((f) => ({ key: f.key, label: f.label, hint: f.hint, max_chars: f.max ?? null })),
          min_items: schema.minItems,
          max_items: schema.maxItems,
          // Who may set which status (1 Oct, items 3, 12, 18): the server
          // keeps a model's status only where this says it may.
          statuses: (schema.statuses ?? []).filter((s) => !s.legacy).map((s) => ({
            value: s.value, label: s.label, requires_reason: Boolean(s.requiresReason),
            model_may_set: Boolean(s.modelMaySet), model_default: Boolean(s.modelDefault),
            // What each status certifies, so the draft describes what was done in the same terms.
            ...(s.explain && !s.legacy ? { explain: s.explain } : {}),
          })),
        }
      : null,
    existing_content: existingContent,
    ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    model: project.model,
  };
}

/**
 * What a draft response stores as version content; '' when it came back
 * unusable. A table that may be empty (Final review's open items: nothing
 * open is the good outcome) stores an empty table rather than reading as
 * "the draft came back empty" (end-to-end pass, 2026-09-29).
 */
export function generationContent(target: StageDefinition, response: GenerateStageArtifactResponse): string {
  if (!rendererHoldsItems(target.renderer)) return response.content.trim() ? response.content : '';
  if (response.items.length === 0) return itemSchemaFor(target).minItems === 0 ? serializeItems([]) : '';
  const content = serializeItems(response.items as unknown as StageItem[]);
  return content.trim() ? content : '';
}

export function evaluationRequest(
  project: Project,
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  stage: StageDefinition,
  content: string,
  approvedOutline: OutlineSection[]
): EvaluateStageArtifactRequest {
  return {
    inputs: inputsFrom(project),
    stage: {
      id: stage.id,
      label: stage.label,
      renderer: stage.renderer,
      entry_prompt_hint: stage.entry_prompt_hint ?? '',
      artifact_kind: stage.expected_artifacts[0]?.kind ?? '',
      // The bar the artifact was written to. The engine still opens gates with
      // pure predicates; this only tells the judge what acceptable was
      // supposed to mean.
      exit_criteria: stage.exit_criteria.map((c) => ({ id: c.id, label: c.label, blocking: Boolean(c.blocking) })),
    },
    content,
    digest: buildStageDigest(template, state, project, bundles, stage.id),
    approved_outline: approvedOutline,
    model: project.model,
  };
}

export function evaluationRecord(
  response: EvaluateStageArtifactResponse,
  fallbackModel: string,
  source: NewEvaluation['source'] = 'manual'
): NewEvaluation {
  const { evaluation } = response;
  return {
    alignment_score: evaluation.alignment.score,
    alignment_explanation: evaluation.alignment.explanation,
    drift_score: evaluation.drift.score,
    drift_explanation: evaluation.drift.explanation,
    clarity_score: evaluation.clarity.score,
    clarity_explanation: evaluation.clarity.explanation,
    completeness_status: evaluation.completeness?.status ?? null,
    completeness_reason: evaluation.completeness?.reason ?? null,
    interpretation: evaluation.interpretation ?? null,
    findings: evaluation.findings ?? [],
    further_pass_needed: evaluation.further_pass_needed ?? null,
    further_pass_reason: evaluation.further_pass_reason || null,
    evaluator_model: response.model_used || fallbackModel,
    source,
  };
}
