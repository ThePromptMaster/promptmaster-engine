'use client';

import { useState } from 'react';

import { describeNeed, needIsDecidedOnStage, type NeedContext, type NeedsUser, type StuckOption } from '@/lib/agent/needs';

/**
 * "I need you to do this before I can continue" — with that exact action
 * right there (B4, Sean 28 Sep item 4). One card, one button; the bare
 * Resume is hidden while it shows, so Resume can never re-trip the same stop.
 */
export function NeedsYouCard({
  need,
  stageLabel,
  onAction,
  context,
}: {
  need: NeedsUser;
  stageLabel: (stageId: string) => string;
  /** Clear the need and resume. Rejects with a message the card shows. A stuck stage says which of its options was chosen. */
  onAction: (option?: StuckOption) => Promise<void>;
  context?: NeedContext;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { message, action, options } = describeNeed(need, stageLabel, context);
  const run = (option?: StuckOption) => {
    setBusy(true);
    setError(null);
    onAction(option)
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : 'That did not work.'))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label="Go mode needs you" className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{need.kind === 'skip_stage' ? 'A suggestion — your call' : 'I need you to…'}</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">{message}</p>
      {options ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {options.map((o, i) => (
            <button
              key={o.id}
              onClick={() => run(o.id)}
              disabled={busy}
              className={
                i === 0
                  ? 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-50'
                  : 'rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-50'
              }
            >
              {busy && i === 0 ? 'Working…' : o.label}
            </button>
          ))}
          <span className="basis-full text-label text-[var(--on-surface-variant)]">
            To move on with this still open, use “Override and continue” at the bottom of the stage; it asks for your reason.
          </span>
        </div>
      ) : action ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => run()}
            disabled={busy}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
          >
            {busy ? 'Working…' : action}
          </button>
          <span className="text-label text-[var(--on-surface-variant)]">
            {need.kind === 'skip_stage'
              ? 'Or press Resume to do this stage after all.'
              : needIsDecidedOnStage(need)
                ? 'Decide each one there. I will notice when they are settled; then press Resume.'
                : 'Or do it yourself on the stage. I will notice, and Resume will appear here.'}
          </span>
        </div>
      ) : (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">Then press Resume.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-label text-[var(--pm-tertiary)]">
          {error}
        </p>
      )}
    </section>
  );
}
