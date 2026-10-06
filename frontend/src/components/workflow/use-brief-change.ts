'use client';

import { useEffect, useRef } from 'react';

import { api } from '@/lib/api/client';
import { BRIEF_FIELDS, finishedConclusions, presentationOnly, type BriefField } from '@/lib/workflow/brief-change';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { NewWorkflowEvent } from '@/lib/supabase/workflow';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';

/** How long a field must stay unchanged before its change is judged: typing is not a change. */
const SETTLE_MS = 2_500;

/**
 * A saved change to the brief reopens only the finished work that relied on it
 * (Sean, 5 Oct). Watches the brief fields; once one has settled on a new value,
 * a wording-only edit is recorded and reopens nothing, and anything else is
 * judged against what each finished stage concluded, then recorded. The page
 * re-reads the log, and the projection marks the named stages for a recheck.
 */
export function useBriefChange({
  project,
  template,
  state,
  bundles,
  stageId,
  appendEvent,
  enabled,
}: {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
  stageId: string;
  appendEvent: (event: NewWorkflowEvent) => Promise<unknown>;
  enabled: boolean;
}) {
  const baseline = useRef<Record<BriefField, string> | null>(null);
  const latest = useRef({ project, template, state, bundles, stageId, appendEvent });
  latest.current = { project, template, state, bundles, stageId, appendEvent };
  const values = BRIEF_FIELDS.map((f) => project[f] ?? '');
  const key = values.join('\u0000');

  useEffect(() => {
    if (!baseline.current) {
      baseline.current = Object.fromEntries(BRIEF_FIELDS.map((f) => [f, project[f] ?? ''])) as Record<BriefField, string>;
      return;
    }
    if (!enabled) return;
    const timer = setTimeout(() => {
      const { project: p, template: t, state: s, bundles: b, stageId: at, appendEvent: append } = latest.current;
      const was = baseline.current!;
      const changed = BRIEF_FIELDS.filter((f) => (p[f] ?? '') !== was[f]);
      if (!changed.length) return;
      baseline.current = Object.fromEntries(BRIEF_FIELDS.map((f) => [f, p[f] ?? ''])) as Record<BriefField, string>;
      void (async () => {
        for (const field of changed) {
          const before = was[field];
          const after = p[field] ?? '';
          if (presentationOnly(before, after)) {
            await append({ type: 'brief_changed', stage_id: at, payload: { field, kind: 'wording', presentation_only: true, affected: [] } });
            continue;
          }
          const stages = finishedConclusions(t, s, b);
          if (!stages.length) continue;
          try {
            const impact = await api.assessChange({ field, before, after, stages, model: p.model });
            await append({
              type: 'brief_changed', stage_id: at,
              payload: { field, kind: impact.kind, presentation_only: false, affected: impact.affected, calculations_hold: impact.calculations_hold },
            });
          } catch {
            // Not being able to judge it is no reason to reopen everything:
            // the change stands, and nothing is marked.
          }
        }
      })();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // The brief's values are the trigger; everything else is read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
