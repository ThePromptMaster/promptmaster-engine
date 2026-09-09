'use client';

/**
 * The recommendations surface's I/O — FR-13, FR-09, FR-01.
 *
 * The panel and the preview dialog are presentational; everything that touches
 * the database or the model lives here, which is what lets both be tested
 * without a Supabase client and lets the preview surface render them against
 * fixtures.
 *
 * ## Three rules this hook exists to keep
 *
 * **Derived recommendations are computed, never written on sight.** They are
 * recomputed each render from the template and the exit-criteria evaluation. A
 * row is inserted only when the user acts on one — `recommendations` has no
 * delete policy, so writing on render would accrete rows nobody can remove.
 *
 * **Evaluation-driven recommendations are written the moment they arrive.**
 * They cost a model call, and FR-01 lists recommendations among the things
 * that must survive a refresh. `useStageEvaluation` used to hold one in React
 * state with a docstring saying M4.2 would own it; this is that.
 *
 * **Apply writes the version first, then accepts, then records the decision.**
 * If the accept fails, the user is left with a good new version and a
 * still-pending recommendation: visible, and re-doable. The reverse order
 * leaves an accepted recommendation pointing at a version that was never
 * written, which is a lie in the audit trail rather than an inconvenience.
 * `appendVersion`'s own docstring gives the same reasoning for the same
 * reason.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, ApiError } from '@/lib/api/client';
import { asFinding } from '@/lib/workflow/combine';
import {
  bySeverity,
  deriveWorkflowRecommendations,
  isApplyable,
  proposalFromCorrection,
  signalsFromEvaluation,
  type ProposedRecommendation,
} from '@/lib/workflow/recommend';
import {
  dismissedCategories,
  insertRecommendation,
  listRecommendations,
  recordDecision,
  resolveRecommendation,
  type Recommendation,
} from '@/lib/supabase/recommendations';
import { createTask, listTasks, setTaskStatus, type ProjectTask } from '@/lib/supabase/tasks';
import type { NewVersion } from '@/lib/supabase/versions';
import type { StageDefinition, StageEvaluation, WorkflowTemplate } from '@/lib/workflow/types';
import type { ArtifactVersion, Evaluation, Project } from '@/types/project';
import type { StageRecommendation } from '@/types';
import { inputsFrom } from './use-stage-evaluation';
import type { PanelRecommendation, TriageStatus } from './recommendations-panel';

interface Options {
  project: Project;
  template: WorkflowTemplate;
  stage: StageDefinition | undefined;
  /** The pure exit-criteria evaluation from `engine.ts`. */
  stageEvaluation: StageEvaluation;
  /** The version a correction would be applied to. */
  headVersion: ArtifactVersion | null;
  /** The stored evaluation for that version, when there is one. */
  storedEvaluation: Evaluation | undefined;
  /** The correction the last evaluate call returned, if any. */
  modelRecommendation: StageRecommendation | null;
  /** Clears it once persisted, so it is not written twice. */
  onModelRecommendationConsumed: () => void;
  /** Absent on the preview surface, and while browsing an earlier stage. */
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  enabled: boolean;
}

function toPanelRow(row: Recommendation): PanelRecommendation {
  return {
    id: row.id,
    origin: 'evaluation',
    category: row.category ?? row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    suggested_change: row.suggested_change,
    instruction: row.instruction,
    rationale: row.rationale,
    scope: row.scope,
    tags: row.tags ?? [],
    severity: row.severity,
  };
}

export function useRecommendations({
  project,
  template,
  stage,
  stageEvaluation,
  headVersion,
  storedEvaluation,
  modelRecommendation,
  onModelRecommendationConsumed,
  appendStageVersion,
  enabled,
}: Options) {
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // --- load ----------------------------------------------------------------

  const reload = useCallback(async () => {
    const [recs, ts] = await Promise.all([
      listRecommendations(project.id),
      listTasks(project.id),
    ]);
    setRows(recs);
    setTasks(ts);
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    // A project with no rows yet is the common case, and a failure here must
    // not take the workspace down with it — the derived half still works.
    Promise.all([listRecommendations(project.id), listTasks(project.id)])
      .then(([recs, ts]) => {
        if (cancelled) return;
        setRows(recs);
        setTasks(ts);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setTasks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Selection is per stage: a row ticked on one stage means nothing on the next.
  const stageId = stage?.id ?? null;
  useEffect(() => {
    setSelected([]);
    setPreviewing(null);
    setError(null);
  }, [stageId]);

  // --- persist the model's correction --------------------------------------

  useEffect(() => {
    if (!modelRecommendation || !stage || !enabled) return;

    const signals = storedEvaluation
      ? signalsFromEvaluation(storedEvaluation)
      : {
          alignment: 'Medium' as const,
          clarity: 'Medium' as const,
          drift: 'Medium' as const,
          completeness: null,
          needs_realignment: false,
        };

    const proposal = proposalFromCorrection(
      modelRecommendation,
      signals,
      stage,
      project.objective
    );

    let cancelled = false;
    insertRecommendation(project.id, project.user_id, {
      ...proposal,
      version_id: headVersion?.id ?? null,
      source_model: storedEvaluation?.evaluator_model || project.model || 'unknown',
    })
      .then((created) => {
        if (cancelled) return;
        setRows((prev) => [...prev, created]);
        onModelRecommendationConsumed();
      })
      .catch(() => {
        // The evaluation itself is already persisted; losing the correction to
        // a write failure is recoverable by evaluating again, and a thrown
        // error here would take the panel down instead.
        if (!cancelled) onModelRecommendationConsumed();
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelRecommendation, stageId, enabled]);

  // --- the list the panel renders -------------------------------------------

  const dismissed = useMemo(() => dismissedCategories(rows), [rows]);

  const derived = useMemo(() => {
    if (!stage) return [];
    return deriveWorkflowRecommendations({
      template,
      stage,
      evaluation: stageEvaluation,
      objective: project.objective,
      dismissed,
    });
  }, [template, stage, stageEvaluation, project.objective, dismissed]);

  const panelRows: PanelRecommendation[] = useMemo(() => {
    const persisted = rows
      .filter((r) => r.status === 'pending' && r.version_id === (headVersion?.id ?? null))
      .map(toPanelRow);

    // Evaluation-driven first once sorted by severity, because they are the
    // ones with a defect behind them; derived rows are almost all `info`.
    const merged: PanelRecommendation[] = [
      ...persisted,
      ...derived.map((d): PanelRecommendation => ({ ...d, origin: 'derived' })),
    ];
    return merged.sort(bySeverity);
  }, [rows, derived, headVersion]);

  const selectedRows = useMemo(
    () => (previewing ? panelRows.filter((r) => previewing.includes(r.category)) : []),
    [previewing, panelRows]
  );

  // --- actions --------------------------------------------------------------

  /**
   * Give a derived recommendation a row.
   *
   * Called at the moment the user acts on one and not before. `status` is
   * passed through because a derived recommendation's first interaction is
   * frequently its last — there was no row to update.
   */
  const materialise = useCallback(
    async (rec: PanelRecommendation, status: 'pending' | 'dismissed'): Promise<Recommendation> => {
      if (rec.id) {
        const existing = rows.find((r) => r.id === rec.id);
        if (existing) return existing;
      }
      const created = await insertRecommendation(project.id, project.user_id, {
        ...(rec as ProposedRecommendation),
        version_id: headVersion?.id ?? null,
        status,
      });
      setRows((prev) => [...prev, created]);
      return created;
    },
    [rows, project.id, project.user_id, headVersion]
  );

  const triage = useCallback(
    async (rec: PanelRecommendation, status: TriageStatus, reason: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        if (status === 'dismissed') {
          const row = rec.id
            ? await resolveRecommendation(rec.id, 'dismissed')
            : await materialise(rec, 'dismissed');
          if (rec.id) setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
          await recordDecision(project.id, project.user_id, {
            decision_type: 'dismiss_recommendation',
            recommendation_id: row.id,
            // The sentence the dismissal cost. This is the whole reason the
            // status demands one.
            rationale: reason || null,
            metadata: { category: rec.category, stage: stage?.id ?? null },
          });
          await reload();
          return;
        }

        if (status === 'deferred') {
          // Leaves the recommendation PENDING. `recommendations.status` has no
          // 'deferred' and must not gain one; a deferred proposal is one the
          // user has neither agreed to nor refused, which is what pending
          // means. The task is what carries it forward (FR-01).
          const row = rec.id ? null : await materialise(rec, 'pending');
          const created = await createTask(project.id, project.user_id, {
            title: rec.title,
            detail: reason || rec.summary,
            stage: stage?.id ?? null,
            origin: rec.origin === 'evaluation' ? 'evaluation' : 'recommendation',
            origin_recommendation_id: rec.id ?? row?.id ?? null,
          });
          setTasks((prev) => [...prev, created]);
          // No `decisions` row: decision_type has no 'defer_recommendation'.
          // See tasks.ts — the gap is documented, not papered over.
          return;
        }

        // 'accepted' with nothing to apply. Applyable rows never reach here —
        // the panel routes those into the preview dialog instead, because an
        // accepted fix that changed nothing is not a fix that was accepted.
        const row = rec.id
          ? await resolveRecommendation(rec.id, 'accepted')
          : await materialise(rec, 'pending');
        await recordDecision(project.id, project.user_id, {
          decision_type: 'accept_recommendation',
          recommendation_id: row.id,
          metadata: { category: rec.category, stage: stage?.id ?? null },
        });
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not record that.');
      } finally {
        setBusy(false);
      }
    },
    [busy, project.id, project.user_id, stage, materialise, reload]
  );

  /**
   * Apply the selected recommendations. FR-09.
   *
   * The only place in this milestone that spends a model call, and it happens
   * after the preview dialog has shown the user the exact instruction, the
   * affected scope, and what happens to the current version.
   */
  const confirmApply = useCallback(async () => {
    if (!stage || !previewing || busy || !appendStageVersion) return;
    const chosen = panelRows.filter((r) => previewing.includes(r.category) && isApplyable(r));
    const content = headVersion?.content ?? '';
    if (chosen.length === 0 || !content.trim()) {
      setError('There is nothing here to revise yet.');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);

    try {
      const response = await api.applyRecommendations(
        {
          inputs: inputsFrom(project),
          content,
          findings: chosen.map(asFinding),
          model: project.model,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;

      // --- version FIRST ---------------------------------------------------
      await appendStageVersion(stage.id, stage.label, {
        content: response.content,
        source_operation: 'applied_recommendations',
        // The literal block that was sent, returned by the endpoint rather
        // than rebuilt here — two places building the same string is two
        // places for it to drift (FR-10).
        instruction: response.instruction,
        model: project.model,
        mode: project.mode,
        change_summary:
          chosen.length === 1
            ? `Applied: ${chosen[0].title}`
            : `Applied ${chosen.length} recommendations together.`,
        finish_reason: response.finish_reason || null,
      });

      // --- then accept, then record ----------------------------------------
      // A failure from here leaves a good version and a still-pending
      // recommendation: visible, and re-doable.
      for (const rec of chosen) {
        const row = rec.id
          ? await resolveRecommendation(rec.id, 'accepted')
          : await materialise(rec, 'pending');
        const accepted = rec.id ? row : await resolveRecommendation(row.id, 'accepted');
        await recordDecision(project.id, project.user_id, {
          decision_type: 'accept_recommendation',
          recommendation_id: accepted.id,
          rationale: null,
          metadata: {
            category: rec.category,
            stage: stage.id,
            applied_with: chosen.length,
          },
        });
      }

      setPreviewing(null);
      setSelected([]);
      await reload();
    } catch (err) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') return;
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not apply that. Nothing was changed.'
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [
    stage,
    previewing,
    busy,
    appendStageVersion,
    panelRows,
    headVersion,
    project,
    materialise,
    reload,
  ]);

  const resolveTask = useCallback(
    async (id: string, status: 'done' | 'dismissed') => {
      try {
        const updated = await setTaskStatus(id, status);
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update that task.');
      }
    },
    []
  );

  return {
    rows: enabled ? panelRows : [],
    tasks,
    selected,
    toggleSelect: useCallback((category: string, checked: boolean) => {
      setSelected((prev) =>
        checked ? [...new Set([...prev, category])] : prev.filter((c) => c !== category)
      );
    }, []),
    previewing: previewing !== null,
    previewRows: selectedRows,
    openPreview: useCallback((categories: string[]) => {
      setError(null);
      setPreviewing(categories);
    }, []),
    closePreview: useCallback(() => setPreviewing(null), []),
    removeFromPreview: useCallback((category: string) => {
      setPreviewing((prev) => {
        const next = (prev ?? []).filter((c) => c !== category);
        // Removing the last one closes the dialog rather than leaving an empty
        // one with a disabled button.
        return next.length > 0 ? next : null;
      });
      setSelected((prev) => prev.filter((c) => c !== category));
    }, []),
    triage,
    confirmApply,
    resolveTask,
    busy,
    error,
  };
}
