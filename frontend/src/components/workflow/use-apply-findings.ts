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

import { type TableRevision, appliedFindingsVersion, reviseWithFindings, type PendingRevision } from '@/lib/workflow/apply-findings';
import type { StageDefinition } from '@/lib/workflow/types';
import type { NewVersion } from '@/lib/supabase/versions';
import type { AuditFinding } from '@/types';
import type { ArtifactVersion, Project } from '@/types/project';

export type { PendingRevision };

export function useApplyFindings({
  project,
  stage,
  headVersion,
  appendStageVersion,
  table,
}: {
  project: Project;
  stage: StageDefinition | undefined;
  headVersion: ArtifactVersion | null;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  /** Set when the stage's draft is a table: it is revised as rows, not as text. */
  table?: TableRevision;
}) {
  const [running, setRunning] = useState(false);
  const [pending, setPending] = useState<PendingRevision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const save = useCallback(
    async (rev: PendingRevision) => {
      if (!stage || !appendStageVersion) return;
      await appendStageVersion(stage.id, stage.label, appliedFindingsVersion(rev, project));
    },
    [stage, appendStageVersion, project]
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
        const rev = await reviseWithFindings({ project, content, findings, source: opts.source, signal: controller.signal, table });
        if (controller.signal.aborted) return;
        // The before/after preview is a text view; a table is saved as a
        // version straight away, and the one before it is a click to restore.
        if (opts.showFirst && !table) setPending(rev);
        else await save(rev);
      } catch (e) {
        if (controller.signal.aborted || (e as Error)?.name === 'AbortError') return;
        const message = e instanceof Error && e.message ? e.message.replace(/\.$/, '') : 'That did not work';
        setError(/nothing was changed/i.test(message) ? `${message}.` : `${message}. Nothing was changed.`);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRunning(false);
      }
    },
    [headVersion, running, project, save, table]
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
