'use client';

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
  const text = 'text-label text-[var(--on-surface-variant)]';
  if (waiting.length) {
    return (
      <div>
        <p className={text}>
          Next: {waiting.length === 1 ? `${waiting[0]} relied on` : `${waiting.join(', ')} relied on`} the old facts and{' '}
          {waiting.length === 1 ? 'is' : 'are'} awaiting an update.
        </p>
        {onUpdate && (
          <button
            onClick={onUpdate}
            disabled={updating}
            className="mt-1.5 rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
          >
            {updating ? 'Updating affected work…' : NEXT_STEP_LABELS.applyContinue}
          </button>
        )}
      </div>
    );
  }
  if (judging) {
    return (
      <p role="status" className={text}>
        Checking what these facts affect…
      </p>
    );
  }
  if (updated?.length) {
    return (
      <p role="status" className={text}>
        <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[16px] text-[var(--pm-success)]">check_circle</span>
        Updated and checked: {updated.join(', ')}.
      </p>
    );
  }
  return <p className={text}>Nothing finished relied on these, so nothing needs updating.</p>;
}
