/**
 * The project's history in one list (14 Oct call, Sean: "you're having these
 * versions as you're going along … can you look up what you've done in the
 * past?"). Every saved version of every stage, and the decisions that moved
 * the project — approvals, reopened stages, brief changes, Go's assessments —
 * newest first. Built from what the workspace has already loaded: the
 * versions are the append-only record and the events are the log, so nothing
 * here is new state. Pure.
 */

import { operationLabel } from './labels';
import type { WorkflowEvent, WorkflowTemplate } from './types';

export interface TimelineEntry {
  key: string;
  at: string;
  stageId: string;
  stageLabel: string;
  kind: 'version' | 'decision';
  /** One line: "v3 · Revised in chat", "Stage approved". */
  title: string;
  /** A version's source operation, so the screen can name it in its own language. */
  operation?: string;
  /** What changed, when it was recorded. */
  detail?: string;
  /** Set on a version: opening it shows that version on its stage. */
  versionId?: string;
  versionNumber?: number;
  /** The palette recorded on the version, for its colour. */
  colourScheme?: string | null;
  /** The newest version of its stage. */
  current?: boolean;
}

/** Events that say something to a reader; the rest (jobs, cursor moves) are bookkeeping. */
export const DECISIONS: Partial<Record<WorkflowEvent['type'], string>> = {
  project_created: 'Project started',
  stage_marked_complete: 'Stage marked complete',
  stage_completed: 'Stage completed',
  stage_reopened: 'Stage reopened to change it',
  outline_approved: 'Outline approved',
  brief_changed: 'The brief changed',
  brief_change_dismissed: 'Kept the stages as they were',
  criterion_committed: 'Approval recorded by Go',
  objective_assessed: 'Objective checked',
  project_finalized: 'Project finished',
  project_reopened: 'Project reopened',
  routine_policy_changed: 'Routine decisions changed',
  web_access_changed: 'Web access changed',
  revision_refused: 'A revision was refused',
};

export function projectTimeline(
  template: Pick<WorkflowTemplate, 'stages'>,
  events: readonly WorkflowEvent[],
  stages: Record<string, { versions: readonly { id: string; version_number: number; source_operation: string; change_summary: string | null; created_at: string; colour_scheme?: string | null }[] } | undefined>
): TimelineEntry[] {
  const label = (id: string) => template.stages.find((s) => s.id === id)?.label ?? id;
  const out: TimelineEntry[] = [];
  for (const s of template.stages) {
    const versions = stages[s.id]?.versions ?? [];
    const head = versions.at(-1)?.id;
    for (const v of versions) {
      out.push({
        key: `v-${v.id}`,
        at: v.created_at,
        stageId: s.id,
        stageLabel: s.label,
        kind: 'version',
        title: `v${v.version_number} · ${operationLabel(v.source_operation)}`,
        operation: v.source_operation,
        ...(v.change_summary ? { detail: v.change_summary } : {}),
        versionId: v.id,
        versionNumber: v.version_number,
        colourScheme: v.colour_scheme ?? null,
        current: v.id === head,
      });
    }
  }
  events.forEach((e, i) => {
    const title = DECISIONS[e.type];
    if (!title) return;
    const reason = typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim() : undefined;
    out.push({
      key: `e-${i}-${e.created_at}`,
      at: e.created_at,
      stageId: e.stage_id,
      stageLabel: e.stage_id ? label(e.stage_id) : '',
      kind: 'decision',
      title,
      ...(reason ? { detail: reason } : {}),
    });
  });
  // Newest first; a version and the event it caused share a moment, and the version reads first.
  return out.sort((a, b) => (a.at === b.at ? (a.kind === 'version' ? -1 : 1) : a.at < b.at ? 1 : -1));
}
