'use client';

import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';

import type { TemplateDiff } from '@/lib/workflow/upgrade';

interface Props {
  name: string;
  fromVersion: number;
  toVersion: number;
  diff: TemplateDiff;
  busy: boolean;
  onUpgrade: () => void;
  onDismiss: () => void;
}

/**
 * "A newer version of this workflow is available" — the way out for projects
 * pinned to a version with a since-fixed dead end (A5).
 *
 * One line with the upgrade button on it; "What changes?" says exactly what
 * would change before anything does. The button used to sit behind that
 * disclosure, and a project kept its old wording and checks for weeks beside
 * a notice nobody opened (2 Oct). Nothing already written is touched: the log
 * refers to stages by id, and stages that still exist keep everything.
 */
export function UpgradeBanner({ name, fromVersion, toVersion, diff, busy, onUpgrade, onDismiss }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const lines = [
    ...diff.changed.map((label) => t('pnl.upChanged', { stage: label })),
    ...diff.added.map((label) => t('pnl.upAdded', { stage: label })),
    ...diff.removed.map((label) => t('pnl.upRemoved', { stage: label })),
  ];

  return (
    <section aria-label={t('pnl.upLabel')} className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">upgrade</span>
        <p className="me-auto text-body text-[var(--on-surface)]">
          {t('pnl.upAvailable', { name })}
          <span className="ms-1 text-label text-[var(--on-surface-variant)]">
            {t('pnl.upNote', { from: fromVersion, to: toVersion })}
          </span>
        </p>
        <button
          onClick={onUpgrade}
          disabled={busy}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-1.5 text-label font-semibold text-[var(--on-primary)] disabled:opacity-50"
        >
          {busy ? t('pnl.upgrading') : t('pnl.upgradeTo', { n: toVersion })}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          {open ? t('pnl.hideChanges') : t('pnl.whatChanges')}
        </button>
        <button onClick={onDismiss} className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
          {t('pnl.notNow')}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <ul className="list-disc space-y-1 ps-6 text-label text-[var(--on-surface-variant)]">
            {(lines.length ? lines : [t('pnl.upWording')]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            {t('pnl.upKept')}
          </p>
        </div>
      )}
    </section>
  );
}
