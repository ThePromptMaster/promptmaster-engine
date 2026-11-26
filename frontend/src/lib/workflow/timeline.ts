/**
 * The project's history in one list (14 Oct call, Sean: "you're having these
 * versions as you're going along … can you look up what you've done in the
 * past?"). Every saved version of every stage, and the decisions that moved
 * the project — approvals, reopened stages, brief changes, Go's assessments —
 * newest first. Built from what the workspace has already loaded: the
 * versions are the append-only record and the events are the log, so nothing
 * here is new state. Pure.
 */

import { statementsOf } from './fact-dependencies';
import { operationLabel } from './labels';
import { plainReason } from './plain-reason';
import type { WorkflowEvent, WorkflowTemplate } from './types';

/**
 * What one change did, read from its event (26 Nov, L-290): the facts it replaced,
 * dropped or added, and the stages it reopened, each with why in the user's words.
 * The event always carried this; the timeline said only "The brief changed".
 */
export interface ChangeDetail {
  /** A fact replaced by another: the old statement and the new. */
  pairs: { from: string; to: string }[];
  removed: string[];
  added: string[];
  reopened: { stageId: string; reason: string }[];
  /** Choices the change set aside, to be made again. */
  setAside: string[];
}

const WORDS = /[\p{L}\p{N}]{3,}/gu;
const overlap = (a: string, b: string) => {
  const wa = new Set(a.toLowerCase().match(WORDS) ?? []);
  const wb = new Set(b.toLowerCase().match(WORDS) ?? []);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
};

/** The change a `brief_changed` event recorded, or null for one that changed only wording. */
export function changeDetail(e: Pick<WorkflowEvent, 'type' | 'payload'>): ChangeDetail | null {
  if (e.type !== 'brief_changed' || !e.payload || e.payload.presentation_only) return null;
  const p = e.payload;
  const before = typeof p.before === 'string' ? p.before : '';
  const after = typeof p.after === 'string' ? p.after : '';
  const isFacts = p.field === 'facts';
  const was = isFacts ? statementsOf(before) : [];
  const now = isFacts ? statementsOf(after) : [];
  const removed = Array.isArray(p.changed_facts) ? (p.changed_facts as unknown[]).filter((x): x is string => typeof x === 'string') : was.filter((f) => !now.includes(f));
  const added = now.filter((f) => !was.includes(f));
  // Each replaced fact paired with the new one that says most of the same thing.
  const pairs: ChangeDetail['pairs'] = [];
  const left = [...added];
  const dropped: string[] = [];
  for (const from of removed) {
    let best = -1;
    let score = 0;
    left.forEach((to, i) => {
      const o = overlap(from, to);
      if (o > score) {
        score = o;
        best = i;
      }
    });
    if (best >= 0 && score >= 0.5) pairs.push({ from, to: left.splice(best, 1)[0] });
    else dropped.push(from);
  }
  const affected = Array.isArray(p.affected) ? (p.affected as { stage_id?: unknown; reason?: unknown }[]) : [];
  const reopened = affected
    .filter((a) => typeof a.stage_id === 'string')
    .map((a) => ({ stageId: a.stage_id as string, reason: plainReason(typeof a.reason === 'string' ? a.reason : '') ?? '' }));
  const aside = Array.isArray(p.decisions_set_aside) ? (p.decisions_set_aside as { choice?: unknown }[]) : [];
  return {
    pairs,
    removed: dropped,
    added: left,
    reopened,
    setAside: aside.map((d) => (typeof d.choice === 'string' ? d.choice : '')).filter(Boolean),
  };
}

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
  /** The colour the user chose for the version, if any. */
  colour?: string | null;
  /** The newest version of its stage. */
  current?: boolean;
  /** A brief or fact change: what it replaced and what it reopened (L-290). */
  change?: ChangeDetail;
  /** Stages a saved version reopened, or that a check kept, by id. */
  reopenedStages?: string[];
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
  version_shared: 'Recorded who has a version',
};

export function projectTimeline(
  template: Pick<WorkflowTemplate, 'stages'>,
  events: readonly WorkflowEvent[],
  stages: Record<string, { versions: readonly { id: string; version_number: number; source_operation: string; change_summary: string | null; created_at: string; colour_scheme?: string | null; colour?: string | null }[] } | undefined>
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
        colour: v.colour ?? null,
        current: v.id === head,
      });
    }
  }
  events.forEach((e, i) => {
    let title = DECISIONS[e.type];
    let reason = typeof e.reason === 'string' && e.reason.trim() ? e.reason.trim() : undefined;
    let reopenedStages: string[] | undefined;
    // A version the user saved that reopened later stages says so (26 Nov).
    if (e.type === 'stage_version_saved' && e.actor === 'user' && Array.isArray(e.payload?.affected) && (e.payload!.affected as unknown[]).length) {
      title = 'Your change reopened later stages';
      reopenedStages = (e.payload!.affected as unknown[]).map((a) => (typeof a === 'string' ? a : typeof (a as { stage_id?: unknown })?.stage_id === 'string' ? (a as { stage_id: string }).stage_id : '')).filter(Boolean);
    }
    if (e.type === 'stage_marked_complete' && e.payload?.checked_unchanged) title = 'Checked after a change and kept';
    if (e.type === 'version_shared') {
      const p = e.payload ?? {};
      if (typeof p.undoes === 'string') title = 'Took back a record of who has a version';
      else {
        const how = typeof p.how === 'string' && p.how ? ` (${p.how})` : '';
        reason = p.not_sending === true
          ? `They keep their version. ${typeof p.note === 'string' ? p.note : ''}`.trim()
          : `v${p.version_number} to ${p.to}, ${p.on}${how}`;
      }
    }
    if (!title) return;
    const change = changeDetail(e);
    out.push({
      key: `e-${i}-${e.created_at}`,
      at: e.created_at,
      stageId: e.stage_id,
      stageLabel: e.stage_id ? label(e.stage_id) : '',
      kind: 'decision',
      title,
      ...(reason ? { detail: reason } : {}),
      ...(change ? { change } : {}),
      ...(reopenedStages?.length ? { reopenedStages } : {}),
    });
  });
  // Newest first; a version and the event it caused share a moment, and the version reads first.
  return out.sort((a, b) => (a.at === b.at ? (a.kind === 'version' ? -1 : 1) : a.at < b.at ? 1 : -1));
}
