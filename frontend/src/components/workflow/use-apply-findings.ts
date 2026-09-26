'use client';

/**
 * Applying critique as new versions (PM-22). One path for every "apply"
 * after a critique — the evaluation's findings, a Challenge's points — so each
 * behaves the same way:
 *
 * - **One model call**, the existing apply endpoint (`/api/apply-recommendations`),
 *   which revises the stored artifact against exactly the findings chosen.
 * - **Show revised version first** (default): the revision is held in memory
 *   and shown as a diff; nothing is saved until Keep. Discard costs nothing
 *   but the call already made.
 * - Otherwise it is saved straight away as a new version. The previous one
 *   stays in history either way, so nothing is ever overwritten (FR-09).
 */

import { useCallback, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { StageDefinition } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { AuditFinding } from '@/types';
import type { ArtifactVersion, Project } from '@/types/project';

export interface PendingRevision {
  findings: AuditFinding[];
  before: string;
  after: string;
  instruction: string;
  finishReason: string | null;
  /** Where the findings came from, for the version's change summary. */
  source: string;
}

export function useApplyFindings({
  project,
  stage,
  headVersion,
  appendStageVersion,
}: {
  project: Project;
  stage: StageDefinition | undefined;
  headVersion: ArtifactVersion | null;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
}) {
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const save = useCallback(
    async (rev: PendingRevision) => {
      if (!stage || !appendStageVersion) return;
      await appendStageVersion(stage.id, stage.label, {
        content: rev.after,
        source_operation: 'applied_findings',
        instruction: rev.instruction,
        model: project.model,
        mode: project.mode,
        change_summary:
          rev.findings.length === 1
            ? `Applied from ${rev.source}: ${rev.findings[0].summary.slice(0, 120)}`
            : `Applied ${rev.findings.length} points from ${rev.source}.`,
        finish_reason: rev.finishReason,
      });
    },
    [stage, appendStageVersion, project.model, project.mode]
  );

  const apply = useCallback(
    async (findings: AuditFinding[], opts: { showFirst: boolean; source: string }) => {
      const content = headVersion?.content ?? '';
      if (!findings.length || !content.trim() || running) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      try {
        const res = await api.applyRecommendations(
          { inputs: inputsFrom(project), content, findings, model: project.model },
          controller.signal
        );
        if (controller.signal.aborted) return;
        if (!res.content.trim()) throw new Error('The model returned nothing usable.');
        const rev: PendingRevision = {
          findings, before: content, after: res.content, instruction: res.instruction,
          finishReason: res.finish_reason || null, source: opts.source,
        };
        if (opts.showFirst) setPending(rev);
        else await save(rev);
      } catch (e) {
        if (controller.signal.aborted || (e as Error)?.name === 'AbortError') return;
        setError(`${e instanceof Error && e.message ? e.message : 'That did not work'}. Nothing was changed.`);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
      }
    },
    [headVersion, running, project, save]
  );

  const keep = useCallback(async () => {
    if (!pending) return;
    setRunning(true);
    try {
      await save(pending);
      setPending(null);
    } catch (e) {
      setError(`${e instanceof Error && e.message ? e.message : 'Could not save it'}. Your current version is untouched.`);
    } finally {
      setRunning(false);
    }
  }, [pending, save]);

  return {
    running,
    pending,
    error,
    apply,
    keep,
    discard: useCallback(() => setPending(null), []),
    dismissError: useCallback(() => setError(null), []),
  };
}
