'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { DerivedOutlineDrift } from '@/lib/workflow/derived-outline';

/**
 * "The work behind this outline has changed since it was approved."
 *
 * The counterpart to StaleDraftsNotice, and built to the same rule: say what
 * moved, name it, and leave the decision with the person who did the work.
 * Re-deriving is offered, never performed — an approved outline is what
 * drafting is bound to, and replacing it without being asked would pull the
 * plan out from under a half-written paper. Nothing written is discarded
 * either way; a section that leaves the outline lands in the orphan tray.
 */

interface Props {
  drift: DerivedOutlineDrift;
  onRederive?: () => void;
  busy?: boolean;
}

export function DerivedOutlineNotice({ drift, onRederive, busy = false }: Props) {
  const t = useT();
  const lines: Array<{ key: string; label: string; titles: string[] }> = [
    { key: 'changed', label: t('ol.briefedDiff'), titles: drift.changed.map((i) => i.title) },
    { key: 'added', label: t('ol.newFromStage'), titles: drift.added.map((i) => i.title) },
    { key: 'removed', label: t('ol.noStageFeeds'), titles: drift.removed.map((i) => i.title) },
  ].filter((l) => l.titles.length > 0);

  if (lines.length === 0) return null;

  return (
    <section
      aria-labelledby="derived-outline-drift-heading"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--pm-tertiary)]">
          sync_problem
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="derived-outline-drift-heading" className="text-title text-[var(--on-surface)]">
            {t('ol.earlierChanged')}
          </h3>
          <p className="mt-1 text-body text-[var(--on-surface-variant)]">
            {t('ol.earlierNote')}
          </p>

          <dl className="mt-3 space-y-2">
            {lines.map((line) => (
              <div
                key={line.key}
                className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-2.5"
              >
                <dt className="text-label text-[var(--on-surface-variant)]">{line.label}</dt>
                <dd className="mt-0.5 text-body text-[var(--on-surface)]">
                  {line.titles.join(', ')}
                </dd>
              </div>
            ))}
          </dl>

          {onRederive && (
            <button
              type="button"
              onClick={onRederive}
              disabled={busy}
              className="mt-3 rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label font-semibold text-[var(--on-surface)] disabled:opacity-50"
            >
              {t('ol.rederive')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
