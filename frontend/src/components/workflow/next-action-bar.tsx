'use client';

import type { NextAction } from '@/lib/workflow/next-step';

/**
 * The one next action, at the top of whichever stage is open (`nextAction`).
 * One button, one short reason — the same words on every stage.
 */
export function NextActionBar({ action, onAct }: { action: NextAction | null; onAct: (a: NextAction) => void }) {
  if (!action) return null;
  if (action.kind === 'working') {
    return (
      <div role="status" aria-label="Next step" className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--surface-container-low)] px-4 py-2.5 text-label text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
        {action.label}
      </div>
    );
  }
  return (
    <section aria-label="Next step" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-4 py-2.5">
      <p className="min-w-0 flex-1 text-label text-[var(--on-surface)]">
        <span className="font-semibold">Next: </span>
        {action.why}
      </p>
      <button
        onClick={() => onAct(action)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)] hover:opacity-90"
      >
        <span aria-hidden className="material-symbols-outlined text-[16px]">play_arrow</span>
        {action.label}
      </button>
    </section>
  );
}
