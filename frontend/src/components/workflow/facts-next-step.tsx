'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { NEXT_STEP_LABELS } from '@/lib/workflow/stage-controls';

/**
 * Under "8 facts recorded": what happens next, and the one button for it
 * (Sean, 14 Oct, SUMMIT: "Could 'Record these facts' change to 'Facts
 * recorded' after success … and clearly direct me to 'Update affected work and
 * resume'?"). The same button, in the same words, as the next-step bar at the
 * top of every stage, so the chat and the page never disagree (17 Oct).
 */
export function FactsNextStep({
  judging,
  waiting,
  onUpdate,
  updating,
  updated,
}: {
  /** The change check is still working out what the facts affect. */
  judging: boolean;
  /** The stages awaiting an update, by label. */
  waiting: readonly string[];
  onUpdate?: () => void;
  updating: boolean;
  /** The stages the last change reopened, once each is finished again. */
  updated?: readonly string[];
}) {
  const t = useT();
  const text = 'text-label text-[var(--on-surface-variant)]';
  if (waiting.length) {
    return (
      <div>
        <p className={text}>
          {t('fns.relied', { count: waiting.length, names: waiting.join(', ') })}
        </p>
        {onUpdate && (
          <button
            onClick={onUpdate}
            disabled={updating}
            className="mt-1.5 rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
          >
            {updating ? t('fns.updating') : NEXT_STEP_LABELS.applyContinue}
          </button>
        )}
      </div>
    );
  }
  if (judging) {
    return (
      <p role="status" className={text}>
        {t('fns.checking')}
      </p>
    );
  }
  if (updated?.length) {
    return (
      <p role="status" className={text}>
        <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[16px] text-[var(--pm-success)]">check_circle</span>
        {t('fns.updated', { names: updated.join(', ') })}
      </p>
    );
  }
  return <p className={text}>{t('fns.nothing')}</p>;
}
