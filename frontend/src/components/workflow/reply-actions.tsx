'use client';

import { useState } from 'react';

import type { RowChange } from '@/lib/workflow/row-actions';
import type { ReplyAction } from '@/types';

/**
 * What to do about a side-chat answer: a few buttons, not one per sentence.
 *
 * The answer can be as rich as it needs to be; the actions are compressed
 * (1 Oct, items 13 and 34: an explanation of why eleven works were unverified
 * came back as "Apply all 14 recommended fixes"). At most four, each one
 * decision, and "Do nothing" always among them. A change to a draft goes
 * through the same preview every other revision does; a change to a table is
 * shown row by row here and saved only on the user's click.
 */
export function ReplyActions({
  actions,
  loading,
  error,
  busy = false,
  previewRows,
  onRun,
  onDismiss,
  onRequest,
  label = 'Act on this reply',
}: {
  /** What these actions are about, for assistive technology. */
  label?: string;
  /** null: not asked for yet. */
  actions: ReplyAction[] | null;
  loading: boolean;
  error?: string | null;
  busy?: boolean;
  /** For a table action: what it would change. Empty means nothing it names can be changed. */
  previewRows?: (action: ReplyAction) => RowChange[];
  onRun: (action: ReplyAction) => Promise<void> | void;
  onDismiss: () => void;
  /** Ask for actions on a reply that has none yet (one from an earlier visit). */
  onRequest?: () => void;
}) {
  const [confirming, setConfirming] = useState<ReplyAction | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (action: ReplyAction) => {
    setWorking(true);
    setFailed(null);
    try {
      await onRun(action);
      setConfirming(null);
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : 'That did not work. Nothing was changed.');
    } finally {
      setWorking(false);
    }
  };

  const button = 'rounded-lg px-3 py-1.5 text-label transition-colors disabled:opacity-50';
  const primary = `${button} bg-[var(--pm-primary)] text-[var(--on-primary)] hover:opacity-90`;
  const quiet = `${button} bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:opacity-90`;

  if (loading) {
    return (
      <p role="status" className="text-label text-[var(--on-surface-variant)]">
        Working out what you could do about this…
      </p>
    );
  }
  if (actions === null) {
    return onRequest ? (
      <button onClick={onRequest} className={quiet}>
        Suggest actions for this reply
      </button>
    ) : null;
  }

  if (confirming) {
    const changes = previewRows?.(confirming) ?? [];
    return (
      <section aria-label="Review the change" className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
        <p className="text-title text-[var(--on-surface)]">{confirming.label}</p>
        {changes.length === 0 ? (
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
            Nothing in the table would change — the rows this names are not there, or already say this.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {changes.map((c) => (
              <li key={c.id} className="text-label text-[var(--on-surface)]">
                <span className="font-semibold">{c.added ? 'New row' : c.title}</span>
                <ul className="mt-0.5 space-y-0.5 text-[var(--on-surface-variant)]">
                  {c.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{failed}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {changes.length > 0 && (
            <button onClick={() => void run(confirming)} disabled={working || busy} className={primary}>
              {working ? 'Saving…' : `Save as a new version (${changes.length} row${changes.length === 1 ? '' : 's'})`}
            </button>
          )}
          <button onClick={() => setConfirming(null)} disabled={working} className={quiet}>
            Back
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={label} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
        {actions.length ? 'What next?' : 'Nothing here needs changing'}
      </p>
      {error && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{error}</p>}
      {failed && (
        <p role="alert" className="mt-1 text-label text-[var(--pm-error)]">{failed}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={`${action.kind}:${action.label}`}
            onClick={() => (action.kind === 'revise' ? void run(action) : setConfirming(action))}
            disabled={working || busy}
            className={primary}
          >
            {action.label}
          </button>
        ))}
        <button onClick={onDismiss} disabled={working} className={quiet}>
          Do nothing
        </button>
      </div>
      {actions.some((a) => a.kind === 'revise') && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          You see the revised version before it is saved.
        </p>
      )}
    </section>
  );
}
