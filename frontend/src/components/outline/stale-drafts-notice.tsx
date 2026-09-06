'use client';

import type { StaleDraftReport } from '@/lib/outline/model';

/**
 * "3 sections were written against outline v1."
 *
 * Approving a newer outline never invalidates prose. It says what is out of
 * step, names the version it was written against, and offers a rewrite per
 * section — the decision stays with whoever wrote the words.
 */

interface Props {
  report: StaleDraftReport;
  titleFor: (itemId: string) => string;
  onRewrite?: (itemId: string) => void;
}

export function StaleDraftsNotice({ report, titleFor, onRewrite }: Props) {
  if (report.stale.length === 0) return null;

  const count = report.stale.length;
  const versions = report.versionNumbers.map((n) => `v${n}`).join(', ');

  return (
    <section
      aria-labelledby="outline-stale-heading"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="material-symbols-outlined text-[20px] text-[var(--pm-tertiary)]"
        >
          history
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="outline-stale-heading" className="text-title text-[var(--on-surface)]">
            {count} section{count === 1 ? ' was' : 's were'} written against outline
            {versions ? ` ${versions}` : ' an earlier version'}
          </h3>
          <p className="mt-1 text-body text-[var(--on-surface-variant)]">
            The writing is untouched. Rewrite a section only if the outline change actually
            affects it.
          </p>

          <ul className="mt-3 space-y-1.5">
            {report.stale.map((binding) => (
              <li
                key={binding.item_id}
                className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-body text-[var(--on-surface)]">
                  {titleFor(binding.item_id)}
                </span>
                <span className="text-label text-[var(--on-surface-variant)]">
                  {binding.word_count.toLocaleString()} words
                </span>
                {onRewrite && (
                  <button
                    type="button"
                    onClick={() => onRewrite(binding.item_id)}
                    aria-label={`Rewrite “${titleFor(binding.item_id)}” against the approved outline`}
                    className="rounded-lg px-3 py-1.5 text-body text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                  >
                    Rewrite
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
