'use client';

/**
 * Under "8 facts recorded": what happens next, and the one button for it
 * (Sean, 14 Oct, SUMMIT: "Could 'Record these facts' change to 'Facts
 * recorded' after success … and clearly direct me to 'Update affected work and
 * resume'?"). The same button as the notice above the stage, so the chat and
 * the page never disagree about the next step.
 */
export function FactsNextStep({
  judging,
  waiting,
  onUpdate,
  updating,
}: {
  /** The change check is still working out what the facts affect. */
  judging: boolean;
  /** The stages awaiting an update, by label. */
  waiting: readonly string[];
  onUpdate?: () => void;
  updating: boolean;
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
            {updating ? 'Updating affected work…' : 'Update affected work and resume'}
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
  return <p className={text}>Nothing finished relied on these, so nothing needs updating.</p>;
}
