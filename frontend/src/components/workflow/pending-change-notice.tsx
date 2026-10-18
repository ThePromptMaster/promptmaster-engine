'use client';

import { gist } from '@/lib/workflow/instruction-conflicts';
import type { PendingChange } from '@/lib/workflow/conflict-trail';

/**
 * "Your change is not applied yet" — on every stage, while a change waits on
 * a "which takes priority?" answer (16 Oct, Sean, NORTHSTAR-2: "I couldn't
 * tell whether the change was pending, rejected, or hadn't been applied").
 * The one whose question is open in the side chat right now is not repeated.
 */
export function PendingChangeNotice({
  changes,
  stageLabel,
  onChoose,
  onDiscard,
}: {
  changes: readonly PendingChange[];
  stageLabel: (id: string) => string;
  onChoose: (change: PendingChange) => void;
  onDiscard: (change: PendingChange) => void;
}) {
  if (!changes.length) return null;
  return (
    <div className="mb-6 flex flex-col gap-2">
      {changes.map((c) => (
        <div
          key={c.id}
          role="status"
          aria-label="Change not applied yet"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-3"
        >
          <span aria-hidden className="material-symbols-outlined text-[20px] text-[var(--pm-tertiary)]">
            pending_actions
          </span>
          <p className="min-w-0 flex-1 text-body text-[var(--on-surface)]">
            Not applied yet — choose which takes priority.
            <span className="block text-label text-[var(--on-surface-variant)]">
              {stageLabel(c.stageId)}: {gist(c.instruction, 140)}
            </span>
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onChoose(c)}
              className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label font-semibold text-[var(--on-primary)]"
            >
              Choose and apply
            </button>
            <button
              type="button"
              onClick={() => onDiscard(c)}
              className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
            >
              Discard
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
