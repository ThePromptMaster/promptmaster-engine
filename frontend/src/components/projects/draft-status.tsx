'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';

export type DraftSaveState = 'saved' | 'saving' | 'failed' | null;

const SHORT: Record<Exclude<DraftSaveState, null>, MessageKey> = {
  saving: 'draft.saving',
  saved: 'draft.savedShort',
  failed: 'draft.failedShort',
};

const FULL: Record<Exclude<DraftSaveState, null>, MessageKey> = {
  saving: 'draft.saving',
  saved: 'draft.savedFull',
  failed: 'draft.failedFull',
};

/**
 * Whether the unfinished setup is saved, in a slot that never changes height.
 *
 * 19 Oct (production pass): the line used to appear on the first keystroke and
 * then switch between a one-line "Saving…" and a two-line "kept as a draft"
 * message on every save, above the goal box — so the box jumped up and down
 * while the user typed (an automated pass lost characters in it). The slot is
 * always there, one line high, and the long wording is its title.
 */
export function DraftStatus({ state }: { state: DraftSaveState }) {
  const t = useT();
  return (
    <p
      role="status"
      aria-label={t('draft.label')}
      title={state ? t(FULL[state]) : undefined}
      className="mb-4 h-5 truncate whitespace-nowrap text-label leading-5 text-[var(--on-surface-variant)]"
    >
      {state && (
        <>
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[16px]">
            {state === 'failed' ? 'cloud_off' : 'cloud_done'}
          </span>
          {t(SHORT[state])}
        </>
      )}
    </p>
  );
}
