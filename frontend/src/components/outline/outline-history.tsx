'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { OutlineVersionView } from '@/lib/outline/model';

/**
 * The outline's version history, with approval shown as a property of a
 * version rather than as a separate concept.
 *
 * This is only possible because an outline version IS an ArtifactVersion:
 * there is no parallel outline_versions table to keep in step, and restoring
 * an outline is the same operation as restoring any other artifact.
 */

interface Props {
  history: OutlineVersionView[];
  /** The version drafting is bound to. */
  approvedVersionId: string | null;
  onRestore?: (versionId: string) => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function OutlineHistory({ history, approvedVersionId, onRestore }: Props) {
  const t = useT();
  if (history.length === 0) return null;

  return (
    <section
      aria-labelledby="outline-history-heading"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <h3 id="outline-history-heading" className="text-title text-[var(--on-surface)]">
        {t('ol.history')}
      </h3>

      <ul className="mt-3 space-y-1.5">
        {[...history].reverse().map((entry) => {
          const isBound = entry.version.id === approvedVersionId;
          return (
            <li
              key={entry.version.id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5"
            >
              <span className="text-label text-[var(--on-surface-variant)]">
                {`v${entry.version.version_number}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-body text-[var(--on-surface)]">
                {t('ol.sections', { count: entry.document.items.length })}
                {entry.version.change_summary ? ` · ${entry.version.change_summary}` : ''}
              </span>

              {entry.approved && (
                <span
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-label ${
                    isBound
                      ? 'bg-[var(--surface-container-high)] text-[var(--pm-secondary)]'
                      : 'text-[var(--on-surface-variant)]'
                  }`}
                >
                  <span aria-hidden className="material-symbols-outlined text-[14px]">
                    check_circle
                  </span>
                  {isBound ? t('ol.approvedBound') : t('ol.approvedEarlier')}
                </span>
              )}

              <span className="text-label text-[var(--on-surface-variant)]">
                {when(entry.version.created_at)}
              </span>

              {onRestore && !isBound && (
                <button
                  type="button"
                  onClick={() => onRestore(entry.version.id)}
                  aria-label={t('ol.restoreLabel', { n: entry.version.version_number })}
                  className="rounded-lg px-3 py-1.5 text-body text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                >
                  {t('ol.restore')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
