/**
 * After a change, what still stands, what is being redone, and what needs the
 * user (L-277). Pure.
 *
 * 22 Nov, Sean: "What I want is for someone to make a change midway through a
 * project and immediately see which parts of the plan they can still use, which
 * need to be redone, and what genuinely needs their judgment." The notice said
 * which stages were reopened and "Everything else stands"; what stands was never
 * named, and a decision the change set aside was one more stage to recheck, its
 * reason the instruction written for the model.
 *
 * Read from what the page already holds: the projected state, the change's own
 * event, what became of each stage (`changeOutcomes`), the approvals given on an
 * earlier text (`reapprovalByStage`) and what waits on the user (`userQueue`), so
 * the rail, the caption and this cannot disagree.
 */
import type { QueueItem } from '@/lib/agent/user-queue';
import type { ChangeOutcome } from './change-outcomes';
import { plainReason } from './plain-reason';
import { isDone, type WorkflowEvent, type WorkflowState, type WorkflowTemplate } from './types';

export type KeptHow = 'checked' | 'by_you' | 'as_was';

export interface ChangeSummary {
  /** Finished, and either untouched by the change or checked against it and kept. */
  usable: { stageId: string; kept?: KeptHow }[];
  /** Reopened by the change: waiting for an update, being redone, or redone. */
  redoing: { stageId: string; state: 'waiting' | 'open' | 'updated'; reason?: string; version?: number | null; by?: 'go' | 'you' | null }[];
  /** What only the user can settle, from the change point on. */
  needsYou: NeedsYouItem[];
}

export type NeedsYouItem =
  | { kind: 'decision'; stageId: string; choice: string; because: string; waitingOn: string[] }
  | { kind: 'reapprove'; stageId: string; version: number; current: number }
  | { kind: 'approval' | 'question'; stageId: string; text: string };

export interface ChangeSummaryInput {
  template: Pick<WorkflowTemplate, 'stages'>;
  state: Pick<WorkflowState, 'stages'>;
  events: readonly WorkflowEvent[];
  /** When the change was made: its event's time. */
  since: string;
  /** The stages it reopened. */
  touched: readonly string[];
  /** What became of each, once finished again (`changeOutcomes`). */
  outcomes: readonly ChangeOutcome[];
  /** Done stages whose approval was given on an earlier text (`reapprovalByStage`). */
  reapprove: Readonly<Record<string, { approvals: string[]; version: number; current: number }>>;
  /** What waits on the user (`userQueue`). */
  queue: readonly QueueItem[];
  manualChecks: Record<string, boolean> | null | undefined;
}

interface SetAside {
  stageId: string;
  criterionId: string;
  choice: string;
  because: string;
}

/** The decisions a change since `since` set aside that are still to be made again. */
function setAsideSince(events: readonly WorkflowEvent[], since: string, manualChecks: Record<string, boolean> | null | undefined): SetAside[] {
  const latest = new Map<string, SetAside>();
  for (const e of events) {
    if (e.type !== 'brief_changed' || e.created_at < since) continue;
    const list = Array.isArray(e.payload?.decisions_set_aside) ? (e.payload!.decisions_set_aside as Partial<SetAside>[]) : [];
    for (const d of list) {
      if (typeof d.criterionId !== 'string' || typeof d.stageId !== 'string') continue;
      latest.set(d.criterionId, { stageId: d.stageId, criterionId: d.criterionId, choice: String(d.choice ?? ''), because: String(d.because ?? '') });
    }
  }
  return [...latest.values()].filter((d) => !manualChecks?.[d.criterionId]);
}

export function changeSummary(input: ChangeSummaryInput): ChangeSummary {
  const { template, state, events, since, outcomes, reapprove, queue, manualChecks } = input;
  const order = template.stages.map((s) => s.id);
  const statusOf = (id: string) => state.stages[id]?.status;
  // What the change reopened, and what reopened after it as a consequence (a repair saved on
  // an earlier stage reopens a done stage after it).
  const touched = new Set(input.touched);
  for (const id of order) {
    const st = state.stages[id];
    if (st?.status === 'stale' && st.stale && st.stale.since >= since) touched.add(id);
  }
  const after = events.filter((e) => e.created_at >= since);
  const checkedKept = new Set(after.filter((e) => e.type === 'stage_marked_complete' && e.payload?.checked_unchanged).map((e) => e.stage_id));
  // "Keep them as they are": on the stages it names, or on every stage the change reopened.
  const dismissals = after.filter((e) => e.type === 'brief_change_dismissed');
  const keptByYou = new Set(dismissals.flatMap((e) => (Array.isArray(e.payload?.stage_ids) ? (e.payload!.stage_ids as string[]) : [])));
  const keptAll = dismissals.some((e) => !Array.isArray(e.payload?.stage_ids));
  const aside = setAsideSince(events, since, manualChecks);
  const asideStages = new Set(aside.map((d) => d.stageId));

  const usable: ChangeSummary['usable'] = [];
  const redoing: ChangeSummary['redoing'] = [];
  for (const id of order) {
    const status = statusOf(id);
    if (!status || status === 'not_started' || status === 'skipped') continue;
    if (asideStages.has(id)) continue;
    if (!touched.has(id)) {
      if (isDone(status)) usable.push({ stageId: id });
      continue;
    }
    if (status === 'stale') {
      redoing.push({ stageId: id, state: 'waiting', reason: plainReason(state.stages[id]?.stale?.reason) });
      continue;
    }
    if (!isDone(status)) {
      redoing.push({ stageId: id, state: 'open' });
      continue;
    }
    const outcome = outcomes.find((o) => o.stageId === id);
    if (outcome && outcome.version !== null) {
      redoing.push({ stageId: id, state: 'updated', version: outcome.version, by: outcome.by });
      continue;
    }
    usable.push({ stageId: id, kept: keptAll || keptByYou.has(id) ? 'by_you' : checkedKept.has(id) ? 'checked' : 'as_was' });
  }

  const needsYou: NeedsYouItem[] = [];
  for (const d of aside) {
    const at = order.indexOf(d.stageId);
    const waitingOn = order.filter((id, i) => i <= at && statusOf(id) === 'stale' && id !== d.stageId);
    needsYou.push({ kind: 'decision', stageId: d.stageId, choice: d.choice, because: d.because, waitingOn });
  }
  const from = Math.min(...[...touched].map((id) => order.indexOf(id)).filter((i) => i >= 0), order.length);
  for (const [stageId, r] of Object.entries(reapprove)) {
    if (order.indexOf(stageId) < from) continue;
    needsYou.push({ kind: 'reapprove', stageId, version: r.version, current: r.current });
  }
  const asideCriteria = new Set(aside.map((d) => d.criterionId));
  for (const q of queue) {
    if (order.indexOf(q.stageId) < from) continue;
    if (q.kind === 'approval') {
      if (q.criterionId && asideCriteria.has(q.criterionId)) continue;
      needsYou.push({ kind: 'approval', stageId: q.stageId, text: q.text });
    } else {
      needsYou.push({ kind: 'question', stageId: q.stageId, text: q.text });
    }
  }
  return { usable, redoing, needsYou };
}

/**
 * The latest change that set a decision aside, while that decision is still to be made
 * again (L-277 follow-up). Once Go had updated the work, nothing waited for a recheck and
 * the reopened decision stage was not finished, so the notice disappeared just when the
 * choice was the one thing left for the user (22 Nov, production pass on the example).
 */
export function decisionStillAwaited(
  events: readonly WorkflowEvent[],
  manualChecks: Record<string, boolean> | null | undefined,
  now: number,
  shownMs: number
): { event: WorkflowEvent; stageIds: string[] } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.type !== 'brief_changed') continue;
    const aside = Array.isArray(e.payload?.decisions_set_aside) ? (e.payload!.decisions_set_aside as Partial<SetAside>[]) : [];
    if (!aside.length) continue;
    if (now - Date.parse(e.created_at) > shownMs) return null;
    if (!aside.some((d) => typeof d.criterionId === 'string' && !manualChecks?.[d.criterionId])) return null;
    const affected = Array.isArray(e.payload?.affected) ? (e.payload!.affected as { stage_id?: unknown }[]) : [];
    const stageIds = [...new Set(affected.map((a) => (typeof a.stage_id === 'string' ? a.stage_id : '')).filter(Boolean))];
    return { event: e, stageIds };
  }
  return null;
}

