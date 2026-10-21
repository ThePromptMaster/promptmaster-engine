'use client';

import { useEffect, useState } from 'react';
import type { NextAction } from '@/lib/workflow/next-step';

/** What the Go controls report, so the bar never looks pressed for nothing. */
export interface GoControlState {
  phase: string;
  pendingStep: boolean;
  authorizing: boolean;
  error: string | null;
}

/**
 * Why the bar's button cannot act right now, or null when it can. The Go
 * panel's own buttons are disabled in these states; the bar used to stay
 * live and a press did nothing visible (19 Oct, production: "Apply and
 * continue" after a failed run).
 */
export function blockedReason(go: GoControlState | undefined): string | null {
  if (!go) return null;
  if (go.phase === 'watching') return 'Go is running in another tab. Stop it there, or wait for it to finish.';
  if (go.pendingStep) return 'Go is waiting for your decision on its proposed step first.';
  return null;
}

/** The bar's actions that start or resume Go; the rest only take the user somewhere. */
const STARTS_GO = new Set<NextAction['kind']>(['apply_continue', 'apply_continue_reopened', 'resume']);

/**
 * The one next action, at the top of whichever stage is open (`nextAction`).
 * One button, one short reason — the same words on every stage.
 */
export function NextActionBar({
  action,
  onAct,
  go,
  onShowGo,
}: {
  action: NextAction | null;
  onAct: (a: NextAction) => void | Promise<void>;
  go?: GoControlState;
  /** Takes the user to Go's panel, where a waiting proposal can be answered. */
  onShowGo?: () => void;
}) {
  // The Go phase at the moment of the press, or null when not pressed.
  const [pressedAt, setPressedAt] = useState<string | null>(null);
  const pressed = pressedAt !== null;
  // A press shows "Starting…" until Go reports it is working (the bar then
  // shows that), what went wrong, or a few seconds pass.
  useEffect(() => {
    if (!pressed) return;
    const t = setTimeout(() => setPressedAt(null), 8_000);
    return () => clearTimeout(t);
  }, [pressed]);
  // …or until Go's phase moves on at all. A run that stopped at once (nothing
  // to do, a pause) left "Starting Go…" spinning for the full eight seconds,
  // which read as a button that had hung (14 Oct call).
  const phase = go?.phase ?? null;
  if (pressed && phase !== null && phase !== pressedAt && !go?.authorizing) setPressedAt(null);
  if (!action) return null;
  if (action.kind === 'working') {
    return (
      <div role="status" aria-label="Next step" className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--surface-container-low)] px-4 py-2.5 text-label text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
        {action.label}
      </div>
    );
  }
  const blocked = blockedReason(go);
  const busy = (pressed && !go?.error) || Boolean(go?.authorizing);
  return (
    <section aria-label="Next step" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-4 py-2.5">
      {/* A real starting width, so the button drops below on a phone instead of squeezing the text (20 Oct). */}
      <p className="min-w-0 flex-[1_1_16rem] text-label text-[var(--on-surface)]">
        <span className="font-semibold">Next: </span>
        {action.why}
      </p>
      <button
        onClick={() => {
          if (STARTS_GO.has(action.kind)) setPressedAt(go?.phase ?? '');
          void Promise.resolve(onAct(action)).catch(() => setPressedAt(null));
        }}
        disabled={Boolean(blocked) || busy}
        title={blocked ?? undefined}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50"
      >
        <span aria-hidden className={`material-symbols-outlined text-[16px]${busy ? ' animate-spin' : ''}`}>{busy ? 'progress_activity' : 'play_arrow'}</span>
        {busy ? 'Starting Go…' : action.label}
      </button>
      {(blocked || go?.error) && (
        <p role="alert" className="basis-full text-label text-[var(--pm-error)]">
          {blocked ?? go?.error}
          {/* The proposal is in Go's panel, often off screen: a disabled
              button and a sentence were all the bar offered (14 Oct call). */}
          {go?.pendingStep && onShowGo && (
            <button type="button" onClick={onShowGo} className="ml-2 font-semibold text-[var(--pm-primary)] underline">
              Show Go&apos;s proposal
            </button>
          )}
        </p>
      )}
    </section>
  );
}
