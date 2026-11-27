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
import { closing, taskKey, tasksMovedPast, type StageHeads, type TaskOutcome } from '@/lib/workflow/task-reconcile';
import type { WorkflowEvent } from '@/lib/workflow/types';
import type { ProjectFact } from '@/types/project';

const MAX_LABELLED = 24;
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
  if (!due.length) return { closed: [], created: [] };

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

  // A reworded task carries on under its new words, once.
  const have = new Set(tasks.filter((t) => t.status !== 'dismissed').map((t) => taskKey(t.title)));
  const closed: ProjectTask[] = [];
  const created: ProjectTask[] = [];
  for (const r of due) {
    if (signal?.aborted) break;
    let o: TaskOutcome = labels.get(r.task.id) ?? { outcome: r.why };
    let replacement: ProjectTask | null = null;
    if (o.outcome === 'reworded') {
      const now = o.now?.trim() ?? '';
      if (!now || !statesAsCurrent(r.head.text, now)) o = { outcome: 'gone' };
      else if (!have.has(taskKey(now))) {
        try {
          replacement = await createTask(project.id, project.user_id, {
            title: now.slice(0, 240),
            stage: r.stageId,
            origin: 'system',
            basis: { from: 'reworded', version_id: r.head.versionId, replaces: r.task.id },
            origin_version_id: r.head.versionId,
          });
          have.add(taskKey(now));
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
  return { closed, created };
}
