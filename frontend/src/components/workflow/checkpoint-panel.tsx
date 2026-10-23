'use client';

import { useT } from '@/lib/i18n/i18n-provider';

/**
 * A stage that produces nothing of its own — Book's Outline approval, which
 * only confirms the outline before drafting binds to it.
 *
 * It used to render the item table, auto-draft "items" into it, fail with
 * "The draft came back empty" and offer "Draft the items". Now it says what it
 * is, and the checklist below it says what it is waiting on.
 */
export function CheckpointPanel() {
  const t = useT();
  return (
    <div className="flex items-start gap-3 rounded-xl bg-[var(--surface-container-low)] px-6 py-5">
      <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">
        fact_check
      </span>
      <div>
        <p className="text-body text-[var(--on-surface)]">{t('pnl.checkpoint')}</p>
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          {t('pnl.checkpointNote')}
        </p>
      </div>
    </div>
  );
}
