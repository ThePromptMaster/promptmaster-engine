'use client';

import { diffWords } from 'diff';
import { useMemo } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

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
  const t = useT();
  const { parts, added, removed } = useWordDiff(revision.before, revision.after);

  return (
    <div role="dialog" aria-modal="true" aria-label={t('pnl.revisedLabel')} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10">
      <div className="w-full max-w-[860px] rounded-2xl bg-[var(--surface-container)] px-7 py-6 shadow-2xl">
        <h2 className="text-title text-[var(--on-surface)]">{t('pnl.revisedTitle')}</h2>
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          {t('pnl.points', { count: revision.findings.length })} ·{' '}
          <span className="text-[var(--pm-success)]">{t('pnl.wordsAdded', { n: added })}</span> ·{' '}
          <span className="text-[var(--pm-error)]">{t('pnl.wordsRemoved', { n: removed })}</span>
        </p>
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-label text-[var(--on-surface-variant)]">
          {revision.findings.map((f) => (
            <li key={f.id}>{f.summary}</li>
          ))}
        </ul>
        <DiffText parts={parts} testId="revision-diff" className="mt-4 max-h-[55vh]" />
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          {t('pnl.keepingSaves')}
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={onKeep} disabled={busy} className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50">
            {t('pnl.keepVersion')}
          </button>
          <button onClick={onDiscard} disabled={busy} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
            {t('pnl.discard')}
          </button>
        </div>
      </div>
    </div>
  );
}

type DiffPart = ReturnType<typeof diffWords>[number];

/** Two texts as word changes, with the words added and removed counted. */
export function useWordDiff(before: string, after: string): { parts: DiffPart[]; added: number; removed: number } {
  return useMemo(() => {
    const parts = diffWords(before, after);
    const count = (keep: (p: DiffPart) => boolean) =>
      parts.filter(keep).reduce((n, p) => n + p.value.trim().split(/\s+/).filter(Boolean).length, 0);
    return { parts, added: count((p) => Boolean(p.added)), removed: count((p) => Boolean(p.removed)) };
  }, [before, after]);
}

/** The text with additions and removals marked in place. */
export function DiffText({ parts, testId, className = '' }: { parts: DiffPart[]; testId?: string; className?: string }) {
  return (
    <div
      data-testid={testId}
      className={`overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3 text-body leading-relaxed text-[var(--on-surface)] ${className}`}
    >
      {parts.map((p, i) =>
        p.added ? (
          <ins key={i} className="rounded-sm bg-[var(--diff-added)] text-[var(--on-surface)] no-underline">{p.value}</ins>
        ) : p.removed ? (
          <del key={i} className="rounded-sm bg-[var(--diff-removed)] text-[var(--on-surface-variant)]">{p.value}</del>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </div>
  );
}
