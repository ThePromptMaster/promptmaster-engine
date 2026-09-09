'use client';

/**
 * Unresolved tasks — FR-01.
 *
 * "Objective, audience, constraints, workflow, stage, artifacts, versions,
 * evaluations, recommendations, and **unresolved tasks** survive refresh,
 * logout, and later login." This is the last item on that list, and the only
 * one that had no surface.
 *
 * Everything here is a `project_tasks` row, so it survives by construction
 * rather than by a store remembering to persist it.
 *
 * ## Where the rows come from
 *
 * Deferring a recommendation ("Not now"). `recommendations.status` has no
 * `deferred` value and must not gain one — it is contract evidence for FR-02 —
 * so the recommendation stays `pending` and a task is written beside it. The
 * sentence the user typed becomes the task's detail, which is why the deferral
 * demands one.
 *
 * ## The honest limitation
 *
 * A deferral does **not** appear in `decisions`: that table's
 * `decision_type` CHECK has no `defer_recommendation`. So the append-only
 * decision trail shows the proposal, and then nothing until the user finally
 * accepts or dismisses it. The task is the only record in between, and tasks
 * are ordinary mutable user data. Closing that gap means a migration adding
 * the decision type — a change to contract evidence, which belongs in its own
 * reviewed commit rather than being slipped in to make this panel look
 * complete.
 */

import type { ProjectTask } from '@/lib/supabase/tasks';

interface Props {
  tasks: ProjectTask[];
  onResolve: (id: string, status: 'done' | 'dismissed') => void;
  busy?: boolean;
  readOnly?: boolean;
}

export function TasksPanel({ tasks, onResolve, busy = false, readOnly = false }: Props) {
  const open = tasks.filter((t) => t.status === 'open');
  if (open.length === 0) return null;

  return (
    <section
      aria-label="Open tasks"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--on-surface)]">Carried forward</h3>
        <span className="text-xs text-[var(--on-surface-variant)]">
          {open.length} open {open.length === 1 ? 'task' : 'tasks'}
        </span>
      </header>

      <ul className="space-y-2">
        {open.map((task) => (
          <li
            key={task.id}
            className="flex items-start gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-body text-[var(--on-surface)]">{task.title}</p>
              {task.detail && (
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{task.detail}</p>
              )}
              {task.stage && (
                <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">
                  From {task.stage}
                </p>
              )}
            </div>

            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => onResolve(task.id, 'done')}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-label text-[var(--pm-secondary)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
                >
                  Done
                </button>
                <button
                  onClick={() => onResolve(task.id, 'dismissed')}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-40"
                >
                  Drop
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
