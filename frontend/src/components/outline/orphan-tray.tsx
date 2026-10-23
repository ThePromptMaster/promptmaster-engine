'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { OrphanedSection } from '@/types/outline';

/**
 * Sections whose prose outlived the outline item it was written for.
 *
 * The tray exists so that "remove" and "regenerate the outline" can be
 * ordinary, unfrightening actions. Nothing written is deleted by a structural
 * edit; it lands here, visible, with the way back one click away.
 */

interface Props {
  orphans: OrphanedSection[];
  wordsFor: (itemId: string) => number;
  readOnly: boolean;
  onReattach: (itemId: string) => void;
  onDiscard: (itemId: string) => void;
}

export function OrphanTray({ orphans, wordsFor, readOnly, onReattach, onDiscard }: Props) {
  const t = useT();
  if (orphans.length === 0) return null;

  return (
    <section
      aria-labelledby="outline-orphans-heading"
      className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <h3 id="outline-orphans-heading" className="text-title text-[var(--on-surface)]">
        {t('ol.detached')}
      </h3>
      <p className="mt-1 text-body text-[var(--on-surface-variant)]">
        {t('ol.detachedNote')}
      </p>

      <ul className="mt-3 space-y-2">
        {orphans.map((orphan) => {
          const name = orphan.title.trim() || t('ol.untitled');
          const words = wordsFor(orphan.item_id);
          return (
            <li
              key={orphan.item_id}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3"
            >
              <span
                aria-hidden
                className="material-symbols-outlined text-[18px] text-[var(--pm-tertiary)]"
              >
                link_off
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-[var(--on-surface)]">{name}</p>
                <p className="text-label text-[var(--on-surface-variant)]">
                  {words > 0 ? t('ol.wordsDot', { n: words.toLocaleString() }) : ''}
                  {orphan.reason === 'regenerated'
                    ? t('ol.droppedRegen')
                    : t('ol.removedFrom')}
                </p>
              </div>

              {!readOnly && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onReattach(orphan.item_id)}
                    aria-label={t('ol.putBackLabel', { name })}
                    className="rounded-lg px-3 py-1.5 text-body text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                  >
                    {t('ol.putBack')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDiscard(orphan.item_id)}
                    aria-label={t('ol.discardLabel', { name })}
                    className="rounded-lg px-3 py-1.5 text-body text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--pm-error)]"
                  >
                    {t('pnl.discard')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
