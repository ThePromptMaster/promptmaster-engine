/**
 * Closes the open tasks the work has moved past, each with why (L-315, 27 Nov).
 * Which tasks is decided in code (`tasksMovedPast`); one small call may say why,
 * with words found in the facts or the current text, and never decides it. Run
 * by the page whenever a stage that holds tasks gets a new version, and by Go
 * before an objective check records new ones. Only open tasks are written, so a
 * second tab or a repeat changes nothing.
 */

import { api } from '@/lib/api/client';
import { closeTaskBySystem, createTask, type ProjectTask } from '@/lib/supabase/tasks';
import { statesAsCurrent } from '@/lib/workflow/fact-values';
import { currentFacts, factLine } from '@/lib/workflow/facts';
import { closing, duplicateTasks, hasSameTask, taskWords, tasksMovedPast, type StageHeads, type TaskOutcome } from '@/lib/workflow/task-reconcile';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ProjectFact } from '@/types/project';

const MAX_LABELLED = 24;
/** A sentence that asks someone to do something: it opens with what to do. */
const ACTION = /^\s*(?:\d+[.)]\s*)?(?:run|produce|send|confirm|check|record|file|pass|pay|make|call|ship|deliver|tell|ask|book|update|prepare|submit|review|approve|obtain|collect|arrange|schedule|notify|contact|issue|complete|keep|hold|load|move|switch)\b/i;
const MAX_FACTS = 120;
const CURRENT_CHARS = 30_000;

export interface RetireInput {
  project: { id: string; user_id: string; objective?: string | null; facts?: readonly ProjectFact[]; model?: string | null };
  heads: StageHeads;
  events: readonly WorkflowEvent[];
  tasks: readonly ProjectTask[];
  signal?: AbortSignal;
}

export interface RetireResult {
  /** Tasks closed by this pass, as saved. */
  closed: ProjectTask[];
  /** Tasks that carry on a reworded one. */
  created: ProjectTask[];
}

export async function retireMovedPastTasks({ project, heads, events, tasks, signal }: RetireInput): Promise<RetireResult> {
  const due = tasksMovedPast(tasks, heads, events);
  if (!due.length) return closeDuplicates(tasks, signal);

  // Why: only for tasks whose sentence left the work; the date rule says its own why.
  const labels = new Map<string, TaskOutcome>();
  const asked = due.filter((r) => r.why === 'gone').slice(0, MAX_LABELLED);
  if (asked.length) {
    try {
      const res = await api.agentTaskOutcomes(
        {
          objective: project.objective ?? '',
          tasks: asked.map((r) => ({ id: r.task.id, text: r.task.title, stage: r.head.label, current: r.head.text.slice(0, CURRENT_CHARS) })),
          facts: currentFacts(project.facts ? [...project.facts] : [])
            .slice(-MAX_FACTS)
            .map((f) => ({ id: f.id, text: factLine(f).replace(/^- /, '').slice(0, 2_500) })),
          ...(project.model ? { model: project.model } : {}),
        },
        signal
      );
      for (const o of res.outcomes ?? []) labels.set(o.id, o);
    } catch {
      // Unlabelled: each is "no longer in" its stage's version.
    }
  }

  // A reworded task carries on under its new words, once: not when the list already holds that action.
  const retiring = new Set(due.map((r) => r.task.id));
  const have = tasks.filter((t) => !retiring.has(t.id));
  const closed: ProjectTask[] = [];
  const created: ProjectTask[] = [];
  for (const r of due) {
    if (signal?.aborted) break;
    let o: TaskOutcome = labels.get(r.task.id) ?? { outcome: r.why };
    let replacement: ProjectTask | null = null;
    // A replacement the work now asks for, word for word, is a task in its place at once, rather than
    // only after the next check (27 Nov, production pass: "Run West payroll from file W4 on the new
    // payroll system" replaced the W3 task and was on no list until then).
    const carriesOn = o.outcome === 'reworded' ? o.now : o.outcome === 'replaced' && r.head.prose && o.quote && statesAsCurrent(r.head.text, o.quote) && ACTION.test(o.quote) ? o.quote : undefined;
    if (carriesOn !== undefined) {
      const now = carriesOn.trim();
      if (!now || !statesAsCurrent(r.head.text, now)) o = o.outcome === 'reworded' ? { outcome: 'gone' } : o;
      else if (!hasSameTask(have, now)) {
        try {
          replacement = await createTask(project.id, project.user_id, {
            title: taskWords(now).slice(0, 240),
            stage: r.stageId,
            origin: 'system',
            basis: { from: 'reworded', version_id: r.head.versionId, replaces: r.task.id },
            origin_version_id: r.head.versionId,
          });
          have.push(replacement);
          created.push(replacement);
        } catch {
          // The old one still closes as reworded; the next check records the new words.
        }
      }
    }
    const c = closing(r, o);
    try {
      const saved = await closeTaskBySystem(r.task, { ...c, basis: { ...c.basis, ...(replacement ? { replaced_by: replacement.id } : {}) } });
      if (saved) closed.push(saved);
    } catch {
      // Left open: the next pass tries again.
    }
  }
  const after = [...tasks.map((t) => closed.find((c) => c.id === t.id) ?? t), ...created];
  const dup = await closeDuplicates(after, signal);
  return { closed: [...closed, ...dup.closed], created };
}

/**
 * Closes the open tasks that repeat another open one, with the one they repeat (27 Nov, museum
 * pass: eleven wordings of "Dispatch carton B2"). Written only where still open, so a repeat
 * changes nothing.
 */
async function closeDuplicates(tasks: readonly ProjectTask[], signal?: AbortSignal): Promise<RetireResult> {
  const closed: ProjectTask[] = [];
  for (const { task, keeps } of duplicateTasks(tasks)) {
    if (signal?.aborted) break;
    try {
      const saved = await closeTaskBySystem(task, {
        status: 'dismissed',
        resolution: `The same action as "${keeps.title.slice(0, 200)}"`,
        basis: { outcome: 'duplicate', quote: keeps.title.slice(0, 240), replaced_by: keeps.id, ...(keeps.stage ? { stage_id: keeps.stage } : {}) },
      });
      if (saved) closed.push(saved);
    } catch {
      // Left open: the next pass tries again.
    }
  }
  return { closed, created: [] };
}
