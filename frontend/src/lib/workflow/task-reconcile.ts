/**
 * What is still to do, read one way everywhere (L-315, 27 Nov).
 *
 * Sean, payroll cutover: after South's completion report the final pack said
 * North N8 was the only run left, while "Carried forward" still told the next
 * operator to pay South on the old system, run West again and run North on
 * both systems: 16 open tasks. "Two people opening different parts of the same
 * project would come away with different instructions."
 *
 * Each objective check records the actions its deliverable names as tasks, and
 * the backend keeps only sentences found in that deliverable word for word. So
 * a task is current while its stage's current version still says it as current
 * work, and once a newer version no longer does, the work has moved past it:
 * the task is retired, and keeps why. No model decides that; one may only say
 * why (done, replaced, reworded), with words found in the facts. A task a model
 * worded itself (Go's "record it", a screened question) keeps the L-293 rule:
 * retired only when a date or [placeholder] it names is gone.
 *
 * While its stage is reopened for a change, a task is on hold: it may be about
 * to change, so it is not shown as something to act on. Pure.
 */

import { staleTasks } from '@/lib/agent/stale-tasks';
import type { ProjectTask, TaskBasis } from '@/lib/supabase/tasks';
import { statesAsCurrent } from './fact-values';
import { plainReason } from './plain-reason';
import { changeDetail } from './timeline';
import type { WorkflowEvent, WorkflowState, WorkflowTemplate } from './types';

/** A stage's current version, as the reconciler reads it. */
export interface StageHead {
  text: string;
  at: string;
  versionId: string;
  versionNumber: number;
  label: string;
  /** Prose is the deliverable's own sentences; anything else (a table, a manuscript) is read by the date rule only. */
  prose: boolean;
}

export type StageHeads = Readonly<Record<string, StageHead | undefined>>;

/** The current version of each stage that has one. */
export function stageHeads(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Readonly<Record<string, { versions: readonly { id: string; version_number: number; content?: string | null; created_at: string }[] } | undefined>>
): Record<string, StageHead> {
  const out: Record<string, StageHead> = {};
  for (const s of template.stages) {
    // A manuscript's chapters are not in its version text; an outreach round's emails are rows.
    if (s.renderer === 'long_form' || s.renderer === 'outreach') continue;
    const head = bundles[s.id]?.versions.at(-1);
    if (!head) continue;
    out[s.id] = {
      text: head.content ?? '',
      at: head.created_at,
      versionId: head.id,
      versionNumber: head.version_number,
      label: s.short_label ?? s.label,
      prose: s.renderer === 'prose',
    };
  }
  return out;
}

/** A task an objective check recorded: a sentence of its deliverable, word for word. */
export function checkBorn(t: Pick<ProjectTask, 'origin' | 'detail' | 'basis'>): boolean {
  if (t.origin !== 'system') return false;
  if (t.basis?.from) return t.basis.from === 'objective_check' || t.basis.from === 'reworded';
  // Before 28 Nov the check's tasks had no basis and no detail; Go's other tasks carry the question.
  return !t.detail;
}

export interface Retirement {
  task: ProjectTask;
  stageId: string;
  head: StageHead;
  /** `gone`: the sentence is no longer in the work; `moved_past`: a date or placeholder it names is gone. */
  why: 'gone' | 'moved_past';
  /** The change to the brief or facts before that version, when there was one. */
  change?: { seq: number; at: string; what: string };
}

const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/**
 * The open tasks the work has moved past: the stage each came from has a
 * version newer than the task, and that version no longer says it.
 */
export function tasksMovedPast(
  tasks: readonly ProjectTask[],
  heads: StageHeads,
  events: readonly WorkflowEvent[] = []
): Retirement[] {
  const out: Retirement[] = [];
  const byDate = new Set(
    staleTasks(
      tasks,
      Object.fromEntries(Object.entries(heads).map(([id, h]) => [id, h ? { text: h.text, at: h.at } : undefined]))
    ).map((t) => t.id)
  );
  for (const task of tasks) {
    if (task.status !== 'open' || task.origin !== 'system' || !task.stage) continue;
    const head = heads[task.stage];
    if (!head?.text.trim() || !after(head.at, task.created_at)) continue;
    let why: Retirement['why'] | null = null;
    if (head.prose && checkBorn(task) && !statesAsCurrent(head.text, task.title)) why = 'gone';
    else if (byDate.has(task.id)) why = 'moved_past';
    if (!why) continue;
    const change = changeBetween(events, task.created_at, head.at);
    out.push({ task, stageId: task.stage, head, why, ...(change ? { change } : {}) });
  }
  return out;
}

/** The last change to the brief or facts recorded after `from` and no later than `to`. */
export function changeBetween(
  events: readonly WorkflowEvent[],
  from: string,
  to: string
): { seq: number; at: string; what: string } | undefined {
  const found = [...events]
    .reverse()
    .find((e) => e.type === 'brief_changed' && after(e.created_at, from) && !after(e.created_at, to) && changeDetail(e));
  if (!found) return undefined;
  const d = changeDetail(found)!;
  const said = d.pairs.length ? d.pairs.map((p) => p.to) : d.added.length ? d.added : d.removed.map((r) => `no longer: ${r}`);
  const field = typeof found.payload?.field === 'string' ? found.payload.field : '';
  const what = (said.join(' ') || (field ? `the ${field.replace(/_/g, ' ')} changed` : 'the brief changed')).slice(0, 300);
  const seq = (found as unknown as { seq?: number }).seq ?? 0;
  return { seq, at: found.created_at, what };
}

/** Why a task closed, as the model labelled it; `gone` when nothing was found. */
export interface TaskOutcome {
  outcome: 'done' | 'replaced' | 'reworded' | 'gone' | 'moved_past';
  quote?: string;
  /** For `reworded`: the sentence of the current version that carries it on. */
  now?: string;
}

/** The closing written onto a task: its status, its reason in words, and what it rested on. */
export function closing(r: Retirement, o: TaskOutcome): { status: 'done' | 'dismissed'; resolution: string; basis: TaskBasis } {
  const at = `${r.head.label} v${r.head.versionNumber}`;
  const resolution =
    o.outcome === 'done' && o.quote ? `Done: "${o.quote}"`
    : o.outcome === 'replaced' && o.quote ? `Replaced: "${o.quote}"`
    : o.outcome === 'reworded' && o.now ? `Reworded in ${at}: "${o.now}"`
    : r.why === 'moved_past' ? `${at} has moved past it`
    : `No longer in ${at}`;
  return {
    status: o.outcome === 'done' && o.quote ? 'done' : 'dismissed',
    resolution: r.change ? `${resolution} (after: ${r.change.what})` : resolution,
    basis: {
      stage_id: r.stageId,
      retired_version_id: r.head.versionId,
      retired_version_number: r.head.versionNumber,
      outcome: o.outcome === 'done' && !o.quote ? 'gone' : o.outcome,
      ...(o.quote ? { quote: o.quote } : {}),
      ...(r.change ? { change: r.change } : {}),
    },
  };
}

export interface HeldTask {
  task: ProjectTask;
  stageId: string;
  /** Why its stage is being redone, in the user's words. */
  reason: string;
}

export interface CurrentTasks {
  /** What someone can act on now. */
  actionable: ProjectTask[];
  /** Open, but its stage is being redone after a change: not to act on until it is. */
  onHold: HeldTask[];
  /** Done or retired, newest first: the history. */
  closed: ProjectTask[];
}

/** The task list as every view reads it: the panel, the finished screen and the status line. */
export function currentTasks(tasks: readonly ProjectTask[], state: Pick<WorkflowState, 'stages'> | null | undefined): CurrentTasks {
  const actionable: ProjectTask[] = [];
  const onHold: HeldTask[] = [];
  for (const task of tasks) {
    if (task.status !== 'open') continue;
    const stale = task.origin === 'system' && task.stage ? state?.stages[task.stage]?.stale : undefined;
    if (stale) onHold.push({ task, stageId: task.stage!, reason: plainReason(stale.reason) ?? stale.reason });
    else actionable.push(task);
  }
  const closed = tasks
    .filter((t) => t.status !== 'open')
    .sort((a, b) => Date.parse(b.resolved_at ?? b.created_at) - Date.parse(a.resolved_at ?? a.created_at));
  return { actionable, onHold, closed };
}

/** Open tasks PromptMaster recorded, on hold or not: what the finished screen and the status line count. */
export function openSystemTasks(tasks: readonly ProjectTask[], state: Pick<WorkflowState, 'stages'> | null | undefined): ProjectTask[] {
  const c = currentTasks(tasks, state);
  return [...c.actionable, ...c.onHold.map((h) => h.task)].filter((t) => t.origin === 'system');
}

/** The normalised key two tasks share when they say the same thing. */
export function taskKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
