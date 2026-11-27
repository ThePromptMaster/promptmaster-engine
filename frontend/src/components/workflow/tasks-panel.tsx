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
 * demands one. An objective check's actions, which follow the deliverable's
 * sentences (L-315).
 *
 * ## What it shows (L-315, 27 Nov)
 *
 * Sean, payroll cutover: "show the operator only what they can still act on",
 * and keep the history "so we can see what changed". So: what can be acted on
 * now; what is on hold because its stage is being updated after a change; and,
 * folded away, what was done or retired, each with why.
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

import { useT } from '@/lib/i18n/i18n-provider';
import type { ProjectTask } from '@/lib/supabase/tasks';
import { currentTasks, type CurrentTasks } from '@/lib/workflow/task-reconcile';

interface Props {
  /** The list as every view reads it (`currentTasks`); built from `tasks` when not given. */
  view?: CurrentTasks;
  tasks?: ProjectTask[];
  onResolve: (id: string, status: 'done' | 'dismissed') => void;
  busy?: boolean;
  readOnly?: boolean;
  /** A stage's name as the page shows it (17 Nov hand pass: "From finished_book_and_review_note"). */
  stageName?: (id: string) => string;
  /** Opens a stage, from a task held or retired there. */
  onOpenStage?: (id: string) => void;
}

/** Why a task closed, in the page's language when its basis says, else as recorded. */
function useWhyClosed() {
  const t = useT();
  return (task: ProjectTask, stage: (id: string) => string): string => {
    const b = task.basis ?? {};
    if (task.resolved_by !== 'system') return t('pnl.closedByYou');
    const where = b.stage_id ? stage(b.stage_id) : '';
    const n = b.retired_version_number ?? 0;
    if (b.outcome === 'done' && b.quote) return t('pnl.closedDone', { quote: b.quote });
    if (b.outcome === 'replaced' && b.quote) return t('pnl.closedReplaced', { quote: b.quote });
    if (b.outcome === 'duplicate' && b.quote) return t('pnl.closedDuplicate', { quote: b.quote });
    if (b.outcome === 'reworded' && where) return t('pnl.closedReworded', { stage: where, n });
    if (b.outcome === 'moved_past' && where) return t('pnl.closedMovedPast', { stage: where, n });
    if (where) return t('pnl.closedGone', { stage: where, n });
    return task.resolution ?? '';
  };
}

export function TasksPanel({ view, tasks = [], onResolve, busy = false, readOnly = false, stageName, onOpenStage }: Props) {
  const t = useT();
  const why = useWhyClosed();
  const { actionable, onHold, closed } = view ?? currentTasks(tasks, null);
  const name = (id: string) => stageName?.(id) || id;
  // What PromptMaster closed is the history worth keeping in view; the user's own Done/Drop shows beside it.
  const history = closed.some((c) => c.resolved_by === 'system') ? closed : [];
  if (actionable.length === 0 && onHold.length === 0 && history.length === 0) return null;
  // Held tasks, grouped by the stage being redone.
  const held = new Map<string, typeof onHold>();
  for (const h of onHold) held.set(h.stageId, [...(held.get(h.stageId) ?? []), h]);

  return (
    <section
      aria-label={t('pnl.tasksLabel')}
      data-tasks-panel
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-title text-[var(--on-surface)]">{t('pnl.carried')}</h3>
        <span className="text-label text-[var(--on-surface-variant)]">
          {t('pnl.openTasks', { count: actionable.length })}
        </span>
      </header>

      {actionable.length > 0 && (
        <ul className="space-y-2" data-tasks-open>
          {actionable.map((task) => (
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
                    {t('pnl.from', { stage: name(task.stage) })}
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
                    {t('pnl.done')}
                  </button>
                  <button
                    onClick={() => onResolve(task.id, 'dismissed')}
                    disabled={busy}
                    className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)] disabled:opacity-40"
                  >
                    {t('pnl.drop')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {[...held].map(([stageId, items]) => (
        <div key={stageId} data-tasks-on-hold={stageId} className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
          <p className="flex items-start gap-2 text-label text-[var(--on-surface)]">
            <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">pause_circle</span>
            <span>
              {t('pnl.onHold', { stage: name(stageId) })}
              {items[0].reason ? <span className="text-[var(--on-surface-variant)]"> {items[0].reason}</span> : null}
            </span>
          </p>
          <ul className="mt-2 space-y-1 pl-7">
            {items.map(({ task }) => (
              <li key={task.id} className="text-body text-[var(--on-surface-variant)]">{task.title}</li>
            ))}
          </ul>
          {onOpenStage && (
            <button onClick={() => onOpenStage(stageId)} className="mt-2 pl-7 text-label text-[var(--pm-secondary)] underline">
              {t('pnl.openStage', { stage: name(stageId) })}
            </button>
          )}
        </div>
      ))}

      {history.length > 0 && (
        <details data-tasks-closed className="mt-3">
          <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">
            {t('pnl.closedHead', { count: history.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map((task) => (
              <li key={task.id} data-task-closed={task.status} className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2">
                <p className="text-body text-[var(--on-surface-variant)] line-through decoration-[var(--outline-variant)]">{task.title}</p>
                <p className="mt-0.5 text-label text-[var(--on-surface)]">
                  <span className="font-semibold">{task.status === 'done' ? t('pnl.done') : t('pnl.retired')}</span>
                  {' · '}
                  {why(task, name)}
                </p>
                {task.basis?.change?.what && (
                  <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{t('pnl.closedAfter', { what: task.basis.change.what })}</p>
                )}
                {onOpenStage && task.basis?.stage_id && (
                  <button onClick={() => onOpenStage(task.basis!.stage_id!)} className="mt-0.5 text-label text-[var(--pm-secondary)] underline">
                    {t('pnl.openStage', { stage: name(task.basis.stage_id) })}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
