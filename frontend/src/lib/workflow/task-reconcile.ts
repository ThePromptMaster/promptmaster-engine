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
  /** Every change between the task and that version, when there was more than one: `closing` picks the one its quote is about. */
  changes?: { seq: number; at: string; what: string }[];
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
    const changes = changesBetween(events, task.created_at, head.at);
    const change = changeFor(changes, task.title);
    out.push({ task, stageId: task.stage, head, why, ...(change ? { change } : {}), ...(changes.length > 1 ? { changes } : {}) });
  }
  return out;
}

/** Every change to the brief or facts recorded after `from` and no later than `to`, oldest first. */
export function changesBetween(
  events: readonly WorkflowEvent[],
  from: string,
  to: string
): { seq: number; at: string; what: string }[] {
  return events
    .filter((e) => e.type === 'brief_changed' && after(e.created_at, from) && !after(e.created_at, to) && changeDetail(e))
    .map((found) => {
      const d = changeDetail(found)!;
      const said = d.pairs.length ? d.pairs.map((p) => p.to) : d.added.length ? d.added : d.removed.map((r) => `no longer: ${r}`);
      const field = typeof found.payload?.field === 'string' ? found.payload.field : '';
      const what = (said.join(' ') || (field ? `the ${field.replace(/_/g, ' ')} changed` : 'the brief changed')).slice(0, 300);
      const seq = (found as unknown as { seq?: number }).seq ?? 0;
      return { seq, at: found.created_at, what };
    });
}

/** The last change to the brief or facts recorded after `from` and no later than `to`. */
export function changeBetween(
  events: readonly WorkflowEvent[],
  from: string,
  to: string
): { seq: number; at: string; what: string } | undefined {
  return changesBetween(events, from, to).at(-1);
}

/** What two lines share that names something: ids (W4, OPS-02) count most, then longer words. */
const IDS = /(?<![\p{L}\p{N}-])[A-Z]{1,8}-?\d{1,4}[A-Za-z]?(?![\p{L}\p{N}])/gu;
const COMMON = new Set(['with', 'from', 'that', 'this', 'have', 'been', 'will', 'into', 'their', 'there', 'they', 'when', 'what', 'which', 'were', 'also', 'only', 'system', 'file']);
const wordsOf = (t: string) => new Set((t.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !COMMON.has(w)));
const idsOf = (t: string) => new Set(t.match(IDS) ?? []);

/**
 * Of several changes before a version, the one a closed task is about (27 Nov, production pass: South's
 * run, closed by its completion report, was shown "after" West's file change, saved a moment later): the
 * change that holds the quote, else the one sharing most words with the task and its quote, else the last.
 */
export function changeFor(
  changes: readonly { seq: number; at: string; what: string }[],
  task: string,
  quote = ''
): { seq: number; at: string; what: string } | undefined {
  if (changes.length <= 1) return changes[0];
  const q = quote.toLowerCase().replace(/\s+/g, ' ').trim();
  const holding = q ? changes.find((c) => c.what.toLowerCase().replace(/\s+/g, ' ').includes(q)) : undefined;
  if (holding) return holding;
  const want = wordsOf(`${task} ${quote}`);
  const ids = idsOf(`${task} ${quote}`);
  let best = changes.at(-1)!;
  let score = -1;
  for (const c of changes) {
    const n = [...idsOf(c.what)].filter((w) => ids.has(w)).length * 10 + [...wordsOf(c.what)].filter((w) => want.has(w)).length;
    if (n > score) {
      score = n;
      best = c;
    }
  }
  return best;
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
  // The change this closing is about, now that its quote is known.
  if (r.changes?.length) r = { ...r, change: changeFor(r.changes, r.task.title, o.quote ?? o.now ?? '') };
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

/**
 * A task's own words, without a list marker or a label in front: "1. Run North payroll…" and
 * "Step: send Morgan Lee's contact sheet…" are "Run North payroll…" and "send Morgan Lee's…"
 * (27 Nov, production passes: a second check added "Step: …", and a reworded line kept its "1.").
 */
export function taskWords(title: string): string {
  return title
    .replace(/^\s*(?:(?:\d{1,3}[.)]|[a-z]\))\s+|[-*•]\s+)?/i, '')
    .replace(/^(?:step|next action|action|next step|then|to do)\s*\d*\s*[:.)–—-]\s*/i, '')
    .trim();
}

/** The normalised key two tasks share when they say the same thing in the same words. */
export function taskKey(title: string): string {
  return taskWords(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const TASK_ID = /(?<![\p{L}\p{N}-])[A-Z]{1,8}-?\d{1,4}[A-Za-z]?(?![\p{L}\p{N}]|-[\p{L}\p{N}])/gu;

/**
 * Whether two tasks are one real-world action in other words (27 Nov, production pass of the museum
 * job: "Dispatch carton B2 …" was recorded eleven times, once each time Go put it aside as work for
 * the real world, each time worded differently). Read in code: the same first verb about the same
 * identifiers (B2, N7, CAL-01), and no name in one that the other leaves out on both sides, so
 * "Send Morgan Lee's sheet under CAL-01" and "Send Alex Rivera's summary under CAL-01" stay two.
 * Without an identifier, only the same words are the same task.
 */
export function sameAction(a: string, b: string): boolean {
  const wa = taskWords(a);
  const wb = taskWords(b);
  if (taskKey(wa) === taskKey(wb)) return true;
  const verb = (s: string) => (s.match(/^\p{L}+/u)?.[0] ?? '').toLowerCase();
  if (!verb(wa) || verb(wa) !== verb(wb)) return false;
  const ids = (s: string) => [...new Set(s.match(TASK_ID) ?? [])].sort().join(' ');
  if (!ids(wa) || ids(wa) !== ids(wb)) return false;
  // Capitalised words after the first: the people, places and organisations the action is about.
  const names = (s: string) => new Set((s.slice(1).match(/\b\p{Lu}\p{Ll}+/gu) ?? []).map((n) => n.toLowerCase()));
  const na = names(wa);
  const nb = names(wb);
  const within = (x: Set<string>, y: Set<string>) => [...x].every((n) => y.has(n));
  return within(na, nb) || within(nb, na);
}

/** Whether the list already holds this action, open or done (a dismissed task does not count). */
export function hasSameTask(tasks: readonly Pick<ProjectTask, 'title' | 'status'>[], title: string): boolean {
  return tasks.some((t) => t.status !== 'dismissed' && sameAction(t.title, title));
}

/**
 * Open tasks that repeat another open one, each with the one it repeats. The one kept is a task the
 * check drew from the work, if there is one, since it follows its sentence there; otherwise the
 * oldest. The page closes the rest with that reason, so a list recorded before `hasSameTask` existed
 * reads as one task per action.
 */
export function duplicateTasks(tasks: readonly ProjectTask[]): { task: ProjectTask; keeps: ProjectTask }[] {
  const open = tasks
    .filter((t) => t.status === 'open')
    .sort((a, b) => Number(checkBorn(b)) - Number(checkBorn(a)) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const kept: ProjectTask[] = [];
  const out: { task: ProjectTask; keeps: ProjectTask }[] = [];
  for (const t of open) {
    const first = kept.find((k) => sameAction(k.title, t.title));
    if (first) out.push({ task: t, keeps: first });
    else kept.push(t);
  }
  return out;
}
