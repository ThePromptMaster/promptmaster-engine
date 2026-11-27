'use client';

/**
 * The latest update, in the Go panel (L-321): what changed, each record it touched with a link,
 * the task list since, and any check that is blocked, with the instruction not to act on that
 * record yet. A blocked check never shows the work after it as ready.
 */

import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { LatestUpdate } from '@/lib/workflow/latest-update';

export function LatestUpdateCard({
  update,
  stageName,
  onOpenStage,
}: {
  update: LatestUpdate | null;
  stageName: (id: string) => string;
  onOpenStage?: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  if (!update) return null;
  const mine = update.blocked.filter((b) => b.fromThisChange);
  const others = update.blocked.filter((b) => !b.fromThisChange);
  const { tasks } = update;
  const taskWords = [
    tasks.done ? t('lu.tasksDone', { count: tasks.done }) : '',
    tasks.retired ? t('lu.tasksRetired', { count: tasks.retired }) : '',
    tasks.added ? t('lu.tasksAdded', { count: tasks.added }) : '',
    tasks.onHold ? t('lu.tasksOnHold', { count: tasks.onHold }) : '',
  ].filter(Boolean);
  const when = new Date(update.at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const link = (id: string) =>
    onOpenStage ? (
      <button onClick={() => onOpenStage(id)} className="text-[var(--pm-secondary)] underline">{stageName(id)}</button>
    ) : (
      <span>{stageName(id)}</span>
    );

  return (
    <section aria-label={t('lu.label')} data-latest-update className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('lu.title')}</h3>
        <span className="text-label text-[var(--on-surface-variant)]">{when}</span>
      </header>
      <p className="mt-2 text-body text-[var(--on-surface)]">
        {t('lu.recorded', { what: update.what.join(' · ') })}
        {update.more > 0 ? ` ${t('lu.more', { count: update.more })}` : ''}
      </p>

      {mine.map((b) => (
        <div key={b.stageId} role="alert" data-latest-blocked={b.stageId} className="mt-2 rounded-lg bg-[var(--error-container)] px-3 py-2 text-body text-[var(--on-error-container)]">
          <p className="font-semibold">
            {t('lu.blocked', { stage: stageName(b.stageId) })}
          </p>
          <p className="mt-0.5 text-label">{b.reason}</p>
          {onOpenStage && (
            <button onClick={() => onOpenStage(b.stageId)} className="mt-1 text-label underline">{t('lu.open', { stage: stageName(b.stageId) })}</button>
          )}
        </div>
      ))}

      {update.records.length > 0 && (
        <ul className="mt-3 space-y-1">
          {update.records.map((r) => (
            <li key={`${r.stageId}-${r.state}`} data-latest-record={r.state} className="text-label text-[var(--on-surface)]">
              {link(r.stageId)}
              {' — '}
              {r.state === 'redone' && r.version ? t('lu.redone', { n: r.version }) : t(`lu.state.${r.state}` as const)}
            </li>
          ))}
        </ul>
      )}

      {taskWords.length > 0 && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]" data-latest-tasks>
          {t('lu.tasks')} {taskWords.join(' · ')}
          {' '}
          <button
            onClick={() => document.querySelector('[data-tasks-panel]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="text-[var(--pm-secondary)] underline"
          >
            {t('lu.openTasks')}
          </button>
        </p>
      )}

      {others.length > 0 && (
        <details className="mt-2" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">{t('lu.othersBlocked', { count: others.length })}</summary>
          <ul className="mt-1 space-y-1">
            {others.map((b) => (
              <li key={b.stageId} className="text-label text-[var(--on-surface-variant)]">
                {link(b.stageId)}: {b.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
