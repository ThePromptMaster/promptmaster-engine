'use client';

import { useState } from 'react';

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
 * Collapsed to one line until asked; opening it says exactly what would
 * change before anything does. Nothing already written is touched: the log
 * refers to stages by id, and stages that still exist keep everything.
 */
export function UpgradeBanner({ name, fromVersion, toVersion, diff, busy, onUpgrade, onDismiss }: Props) {
  const [open, setOpen] = useState(false);
  const lines = [
    ...diff.changed.map((label) => `${label}: requirements or layout updated`),
    ...diff.added.map((label) => `New stage: ${label}`),
    ...diff.removed.map((label) => `Removed stage: ${label} (anything written there is kept)`),
  ];

  return (
    <section aria-label="Workflow update" className="mb-6 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">upgrade</span>
        <p className="mr-auto text-body text-[var(--on-surface)]">
          A newer version of the {name} workflow is available.
          <span className="ml-1 text-label text-[var(--on-surface-variant)]">
            (You are on v{fromVersion}; v{toVersion} is current.)
          </span>
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          {open ? 'Hide changes' : 'What changes?'}
        </button>
        <button onClick={onDismiss} className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
          Not now
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <ul className="list-disc space-y-1 pl-6 text-label text-[var(--on-surface-variant)]">
            {(lines.length ? lines : ['Wording and guidance updates']).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            Everything you have written, every version and every decision is kept.
          </p>
          <button
            onClick={onUpgrade}
            disabled={busy}
            className="mt-3 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
          >
            {busy ? 'Upgrading…' : `Upgrade to v${toVersion}`}
          </button>
        </div>
      )}
    </section>
  );
}
