'use client';

import { useCallback } from 'react';

import { api } from '@/lib/api/client';
import { changeWindow } from '@/lib/data/context-for-request';
import { finishedConclusions } from '@/lib/workflow/brief-change';
import { referenceChange, referenceName } from '@/lib/workflow/reference-change';
import type { NewWorkflowEvent } from '@/lib/supabase/workflow';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { Project, ProjectReference, ReferenceSnapshot } from '@/types/project';

/**
 * "Update from the original" as a change (28 Nov, Sean, Harborlight; L-326).
 *
 * Called once the new copy is stored. When the reference now says something
 * else, the work written so far — finished stages and drafts in progress, all
 * of which were sent the old copy — is judged against the change by the same
 * check a brief edit gets, and one `brief_changed` is recorded naming the
 * stages that relied on it. The projection then marks them "needs recheck".
 * A check that cannot be made still records the change, reopening nothing, as
 * a brief edit does.
 */
export function useReferenceChange(input: {
  project: Pick<Project, 'model'>;
  template: WorkflowTemplate;
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
  stageId: string;
  appendEvent: (event: NewWorkflowEvent) => Promise<unknown>;
}): (ref: ProjectReference, before: ReferenceSnapshot | null | undefined, after: ReferenceSnapshot | null | undefined, index: number) => Promise<void> {
  const { project, template, state, bundles, stageId, appendEvent } = input;
  const model = project.model;
  return useCallback(async (ref, before, after, index) => {
    const change = referenceChange(before, after, ref.include_facts);
    if (!change) return;
    const name = referenceName(index, after?.title || before?.title || '');
    const recorded = {
      field: 'context', origin: 'reference', presentation_only: false,
      reference: { id: ref.id, project_id: ref.referenced_project_id, name },
      ...change,
    };
    const stages = finishedConclusions(template, state, bundles, undefined, true);
    let judged: { kind: string; affected: { stage_id: string; reason: string }[]; calculations_hold?: boolean } = { kind: 'fact', affected: [] };
    if (stages.length) {
      try {
        const impact = await api.assessChange({
          field: 'earlier_stage', label: `the linked project ${name}`, ...changeWindow(change.before, change.after), stages, model: model || undefined,
        });
        const known = new Set(stages.map((s) => s.stage_id));
        judged = { kind: impact.kind, affected: impact.affected.filter((a) => known.has(a.stage_id)), calculations_hold: impact.calculations_hold };
      } catch {
        // Not judged: the change is recorded and nothing is marked, as for a brief edit.
      }
    }
    await appendEvent({
      type: 'brief_changed', stage_id: stageId,
      payload: { ...recorded, ...judged, had_computed: stages.some((s) => s.computed) },
    }).catch(() => undefined);
  }, [model, template, state, bundles, stageId, appendEvent]);
}
