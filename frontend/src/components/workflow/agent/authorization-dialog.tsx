'use client';

import { KEEP_GOING_WINDOWS, POLICY_TERMS } from '@/lib/agent/authorize';
import type { ExecutionPolicy } from '@/types/agent';

/**
 * Checkpoint and Autonomous act without asking each time, so they start with
 * an explicit authorization that is recorded (an accepted proposal plus a
 * decision) and that the database checks every autonomous stage move against.
 */
export function AuthorizationDialog({
  policy,
  budget,
  autoWindows = 0,
  onAutoWindows,
  onAuthorize,
  onCancel,
}: {
  policy: Exclude<ExecutionPolicy, 'guided'>;
  budget: number;
  /** Further windows the run may start on its own. Offered for Autonomous only. */
  autoWindows?: number;
  onAutoWindows?: (n: number) => void;
  onAuthorize: () => void;
  onCancel: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-label="Authorize Go mode"
      className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4"
    >
      <h3 className="text-title text-[var(--on-surface)]">
        Let Go mode run {policy === 'autonomous' ? 'autonomously' : 'with checkpoints'}?
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-[var(--on-surface)]">
        {POLICY_TERMS[policy].map((t) => (
          <li key={t}>{t}</li>
        ))}
        <li>
          In windows of {budget} steps. When a window is used up, Go stops and offers another; each further window is your
          click, and is recorded. You can press Stop at any time.
        </li>
      </ul>
      {policy === 'autonomous' && onAutoWindows && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-body text-[var(--on-surface)]">
          When a window is used up, carry on without asking for
          <select
            value={autoWindows}
            onChange={(e) => onAutoWindows(Number(e.target.value))}
            aria-label="Further windows without asking"
            className="rounded-md bg-[var(--surface-container-low)] px-2 py-1 text-body text-[var(--on-surface)]"
          >
            <option value={0}>no further windows</option>
            <option value={1}>1 more window</option>
            <option value={2}>2 more windows</option>
            <option value={3}>3 more windows</option>
            <option value={KEEP_GOING_WINDOWS}>keep going — up to {KEEP_GOING_WINDOWS} more windows</option>
          </select>
          <span className="text-label text-[var(--on-surface-variant)]">
            {autoWindows > 0
              ? `At most ${budget * (autoWindows + 1)} steps before it stops and asks. Each window is recorded${
                  autoWindows >= KEEP_GOING_WINDOWS ? '; it still stops whenever it needs you, and each new round of open-ended work is yours to start' : ''
                }.`
              : 'It stops and asks after each window.'}
          </span>
        </label>
      )}
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        This authorization is recorded on the project&apos;s decision trail.
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={onAuthorize} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
          Authorize and go
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Cancel
        </button>
      </div>
    </section>
  );
}
