'use client';

export type DraftSaveState = 'saved' | 'saving' | 'failed' | null;

const SHORT: Record<Exclude<DraftSaveState, null>, string> = {
  saving: 'Saving your setup…',
  saved: 'Setup kept as a draft — nothing is a project until you make it one.',
  failed: 'Not saved as a draft — kept on this page until you leave.',
};

const FULL: Record<Exclude<DraftSaveState, null>, string> = {
  saving: 'Saving your setup…',
  saved: 'Your setup is kept as a draft, conversation included — you can sign out and come back. Nothing is a project until you make it one (Make it a project, or Start).',
  failed: 'Your setup could not be saved as a draft; it is kept on this page until you leave.',
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
  return (
    <p
      role="status"
      aria-label="Setup draft"
      title={state ? FULL[state] : undefined}
      className="mb-4 h-5 truncate whitespace-nowrap text-label leading-5 text-[var(--on-surface-variant)]"
    >
      {state && (
        <>
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[16px]">
            {state === 'failed' ? 'cloud_off' : 'cloud_done'}
          </span>
          {SHORT[state]}
        </>
      )}
    </p>
  );
}
