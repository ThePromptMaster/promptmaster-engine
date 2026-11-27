'use client';

/**
 * Keeps the task list in step with the work (L-315, 27 Nov). Whenever a stage
 * that holds open tasks gets a new version, by Go, the page, the side chat or an
 * applied finding, the tasks that version no longer says are closed with why.
 * Opening a project whose list fell behind before this existed does the same
 * once (Sean's payroll project: 16 open tasks against a pack that left one run).
 * An open task that repeats another in other words is closed as the same action.
 */

import { useEffect, useMemo, useRef } from 'react';
import { retireMovedPastTasks } from '@/lib/agent/retire-tasks';
import type { ProjectTask } from '@/lib/supabase/tasks';
import { duplicateTasks, stageHeads, tasksMovedPast } from '@/lib/workflow/task-reconcile';
import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { Project } from '@/types/project';
import type { StageBundle } from '@/stores/project-store';

interface Args {
  project: Pick<Project, 'id' | 'user_id' | 'objective' | 'facts' | 'model'> | null;
  template: WorkflowTemplate;
  bundles: Record<string, StageBundle> | undefined;
  events: readonly WorkflowEvent[] | undefined;
  tasks: readonly ProjectTask[];
  upsertTask: (task: ProjectTask) => void;
  enabled: boolean;
}

export function useTaskReconcile({ project, template, bundles, events, tasks, upsertTask, enabled }: Args): void {
  const heads = useMemo(() => stageHeads(template, bundles ?? {}), [template, bundles]);
  // What is due now, as a key: a task and the version that moved past it. Each is tried once per page.
  const due = useMemo(() => tasksMovedPast(tasks, heads, events ?? []), [tasks, heads, events]);
  // …and an open task that repeats another, in other words (27 Nov, museum: eleven "Dispatch carton B2").
  const repeats = useMemo(() => duplicateTasks(tasks), [tasks]);
  const key = [...due.map((r) => `${r.task.id}@${r.head.versionId}`), ...repeats.map((d) => `${d.task.id}=${d.keeps.id}`)].join(',');
  const tried = useRef(new Set<string>());
  const running = useRef(false);
  const latest = useRef({ project, heads, events, tasks, upsertTask });
  // Kept current after each render, before the effect below reads it.
  useEffect(() => {
    latest.current = { project, heads, events, tasks, upsertTask };
  });

  useEffect(() => {
    if (!enabled || !key || running.current) return;
    const fresh = key.split(',').filter((k) => !tried.current.has(k));
    if (!fresh.length) return;
    for (const k of fresh) tried.current.add(k);
    const { project: p, heads: h, events: ev, tasks: ts } = latest.current;
    if (!p) return;
    running.current = true;
    void retireMovedPastTasks({ project: p, heads: h, events: ev ?? [], tasks: ts })
      .then(({ closed, created }) => {
        // Only into the list of the project still open: the page may have moved on.
        const now = latest.current;
        for (const t of [...closed, ...created]) if (now.project?.id === t.project_id) now.upsertTask(t);
      })
      .catch(() => {
        // The list stays as it was; nothing here holds up the work.
      })
      .finally(() => {
        running.current = false;
      });
  }, [enabled, key]);
}
