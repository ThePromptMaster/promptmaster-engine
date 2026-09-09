'use client';

/**
 * Evaluating a stage's artifact — FR-11, FR-12.
 *
 * The counterpart to `use-stage-generation`, and deliberately its opposite in
 * one respect: **nothing here fires on its own**. Drafting auto-starts because
 * a blank stage is useless; evaluation does not, because it is a model call the
 * user should choose to spend. That is the product decision, and the copy on
 * the control says so.
 *
 * Two other properties carried over from drafting, for the same reasons:
 *
 * - **Interruptible.** An AbortController per run, aborted on unmount, so an
 *   evaluation the user walked away from cannot attach itself to the stage
 *   they moved to.
 * - **It writes to the version it judged.** The evaluation is attached to the
 *   existing head version rather than appended as a new one — the content did
 *   not change, and a version whose only novelty is that it was scored would
 *   pollute every history view from then on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api/client';
import { buildStageDigest, type StageArtifactBundle } from '@/lib/workflow/digest';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewEvaluation } from '@/lib/supabase/versions';
import type { Evaluation, Project } from '@/types/project';
import type { OutlineSection, PMInput, StageRecommendation } from '@/types';

interface Options {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition | undefined;
  bundles: Record<string, StageArtifactBundle>;
  /** FR-12's fourth axis, when the project has an approved outline. */
  approvedOutline: OutlineSection[];
  /** Browsing an earlier stage must not let you spend a call on it. */
  enabled: boolean;
  recordStageEvaluation?: (
    stageId: string,
    versionId: string,
    evaluation: NewEvaluation
  ) => Promise<Evaluation>;
}

function inputsFrom(project: Project): PMInput {
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
  };
}

export function useStageEvaluation({
  project,
  template,
  state,
  stage,
  bundles,
  approvedOutline,
  enabled,
  recordStageEvaluation,
}: Options) {
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The recommendation lives here rather than in the database.
   *
   * M4.2 owns the `recommendations` table and the accept/dismiss surface;
   * writing rows into it now would mean writing rows nothing can yet triage.
   * So it is shown alongside the evaluation that produced it and goes away on
   * reload — the evaluation itself, findings included, is persisted.
   */
  const [recommendation, setRecommendation] = useState<StageRecommendation | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const latest = useRef({ project, template, state, bundles, approvedOutline, recordStageEvaluation });
  latest.current = { project, template, state, bundles, approvedOutline, recordStageEvaluation };

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setEvaluating(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  // A recommendation describes one stage's artifact. Carrying it across a
  // stage change would attach last stage's advice to this stage's work.
  const stageId = stage?.id ?? null;
  useEffect(() => {
    setRecommendation(null);
    setError(null);
  }, [stageId]);

  const evaluate = useCallback(async () => {
    const {
      project: p,
      template: t,
      state: s,
      bundles: b,
      approvedOutline: outline,
      recordStageEvaluation: record,
    } = latest.current;

    if (!stage || !record) return;

    const version = b[stage.id]?.versions.at(-1);
    if (!version?.content.trim()) {
      setError('There is nothing here to evaluate yet.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setEvaluating(true);
    setError(null);

    try {
      const response = await api.evaluateStageArtifact(
        {
          inputs: inputsFrom(p),
          stage: {
            id: stage.id,
            label: stage.label,
            renderer: stage.renderer,
            entry_prompt_hint: stage.entry_prompt_hint ?? '',
            artifact_kind: stage.expected_artifacts[0]?.kind ?? '',
            // The bar the artifact was written to. The engine still opens
            // gates with pure predicates; this only tells the judge what
            // acceptable was supposed to mean.
            exit_criteria: stage.exit_criteria.map((c) => ({
              id: c.id,
              label: c.label,
              blocking: Boolean(c.blocking),
            })),
          },
          content: version.content,
          digest: buildStageDigest(t, s, p, b, stage.id),
          approved_outline: outline,
          model: p.model,
        },
        controller.signal
      );

      if (controller.signal.aborted) return;

      const { evaluation } = response;
      await record(stage.id, version.id, {
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
        evaluator_model: p.model,
        // 'manual' is the source this is: a user pressed a button, rather than
        // the four-call pipeline producing one as a side effect.
        source: 'manual',
      });

      setRecommendation(response.recommendation);
    } catch (err) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not evaluate this stage. Try again in a moment.'
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setEvaluating(false);
    }
  }, [stage]);

  return {
    evaluating,
    error,
    recommendation,
    dismissRecommendation: useCallback(() => setRecommendation(null), []),
    evaluate: enabled && recordStageEvaluation ? evaluate : undefined,
    cancel,
  };
}
