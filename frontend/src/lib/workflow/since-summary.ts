/**
 * Everything that happened to a project since a moment (26 Nov, L-290). Pure.
 *
 * Sean, 25 Nov: "At change 30, can they pick up where they left off without
 * repeating facts, finding stale recommendations themselves, or checking every
 * deliverable by hand? Can they tell what they can rely on and see the record
 * behind it?" The change notice told only the latest change, while it was open.
 * This reads the log from the viewer's last visit: every change and what it
 * replaced, each stage redone (by whom, to which version), what was checked and
 * kept, and what was recorded as sent.
 */
import { changeDetail, type ChangeDetail } from './timeline';
import type { WorkflowEvent } from './types';

export interface SinceSummary {
  changes: { at: string; field: string; detail: ChangeDetail }[];
  /** Each stage's newest version saved since, and who saved it. */
  redone: { stageId: string; version: number; by: 'go' | 'you' }[];
  /** Stages checked against a change and kept as they were. */
  kept: string[];
  sent: { stageId: string; version: number; to: string }[];
  finished: boolean;
  /** Stages the changes reopened, for the "now" view (`changeSummary`). */
  touched: string[];
}

export function changesSince(events: readonly WorkflowEvent[], since: string): SinceSummary {
  const after = events.filter((e) => e.created_at > since);
  const changes: SinceSummary['changes'] = [];
  const redone = new Map<string, SinceSummary['redone'][number]>();
  const kept = new Set<string>();
  const sent: SinceSummary['sent'] = [];
  const touched = new Set<string>();
  let finished = false;
  for (const e of after) {
    if (e.type === 'brief_changed') {
      const detail = changeDetail(e);
      if (!detail) continue;
      changes.push({ at: e.created_at, field: typeof e.payload?.field === 'string' ? e.payload.field : '', detail });
      for (const r of detail.reopened) touched.add(r.stageId);
    } else if (e.type === 'stage_version_saved' && typeof e.payload?.version_number === 'number') {
      redone.set(e.stage_id, { stageId: e.stage_id, version: e.payload.version_number, by: e.actor === 'system' ? 'go' : 'you' });
      const affected = Array.isArray(e.payload.affected) ? (e.payload.affected as unknown[]) : [];
      for (const a of affected) if (typeof a === 'string') touched.add(a);
    } else if (e.type === 'stage_marked_complete' && e.payload?.checked_unchanged) {
      kept.add(e.stage_id);
      touched.add(e.stage_id);
    } else if (e.type === 'version_shared' && typeof e.payload?.undoes !== 'string' && e.payload?.not_sending !== true) {
      sent.push({ stageId: e.stage_id, version: Number(e.payload?.version_number) || 0, to: String(e.payload?.to ?? '') });
    } else if (e.type === 'project_finalized') finished = true;
    else if (e.type === 'project_reopened') finished = false;
  }
  return { changes, redone: [...redone.values()], kept: [...kept], sent, finished, touched: [...touched] };
}

/** Whether anything worth telling happened since. */
export function anythingSince(s: SinceSummary): boolean {
  return s.changes.length > 0 || s.redone.length > 0 || s.kept.length > 0 || s.sent.length > 0;
}
