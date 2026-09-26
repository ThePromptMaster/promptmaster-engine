'use client';

import { diffWords } from 'diff';
import { useMemo } from 'react';

import type { PendingRevision } from './use-apply-findings';

/**
 * "Show revised version first" (PM-22): the revision, as changes against the
 * current version, before anything is saved. Keep saves it as a new version;
 * Discard leaves the stage exactly as it was.
 */
export function RevisedPreview({
  revision,
  busy,
  onKeep,
  onDiscard,
}: {
  revision: PendingRevision;
  busy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const parts = useMemo(() => diffWords(revision.before, revision.after), [revision]);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);

  return (
    <div role="dialog" aria-modal="true" aria-label="Revised version" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10">
      <div className="w-full max-w-[860px] rounded-2xl bg-[var(--surface-container)] px-7 py-6 shadow-2xl">
        <h2 className="text-title text-[var(--on-surface)]">The revised version — not saved yet</h2>
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          {revision.findings.length === 1 ? 'One point' : `${revision.findings.length} points`} applied ·{' '}
          <span className="text-[var(--pm-success)]">+{added} words</span> ·{' '}
          <span className="text-[var(--pm-error)]">−{removed} words</span>
        </p>
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-label text-[var(--on-surface-variant)]">
          {revision.findings.map((f) => (
            <li key={f.id}>{f.summary}</li>
          ))}
        </ul>
        <div
          data-testid="revision-diff"
          className="mt-4 max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)]"
        >
          {parts.map((p, i) =>
            p.added ? (
              <ins key={i} className="rounded-sm bg-[var(--success-container)] text-[var(--on-surface)] no-underline decoration-[var(--pm-success)]">{p.value}</ins>
            ) : p.removed ? (
              <del key={i} className="rounded-sm bg-[var(--error-container)] text-[var(--on-surface-variant)]">{p.value}</del>
            ) : (
              <span key={i}>{p.value}</span>
            )
          )}
        </div>
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          Keeping it saves a new version; the current one stays in history.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={onKeep} disabled={busy} className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50">
            Keep this version
          </button>
          <button onClick={onDiscard} disabled={busy} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
