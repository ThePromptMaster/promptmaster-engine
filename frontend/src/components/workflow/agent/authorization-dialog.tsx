'use client';

import { KEEP_GOING_WINDOWS, POLICY_TERMS } from '@/lib/agent/authorize';
import type { ExecutionPolicy } from '@/types/agent';

/**
 * What Go may do, said once beside the button (17 Oct, Sean: "the directions
 * are a little too wordy for the authorized button … somebody just felt
 * paralyzed"). Pressing Go with Checkpoint or Autonomous is the authorization:
 * it is recorded on the decision trail (an accepted proposal plus a decision)
 * and the database checks every autonomous stage move against it. The full
 * terms are one click away rather than a dialog in the way.
 */
export function GoTerms({
  policy,
  budget,
  autoWindows = 0,
  onAutoWindows,
  disabled = false,
}: {
  policy: Exclude<ExecutionPolicy, 'guided'>;
  budget: number;
  /** Further windows the run may start on its own. Offered for Autonomous only. */
  autoWindows?: number;
  onAutoWindows?: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div aria-label="What Go may do" className="space-y-2 text-label text-[var(--on-surface-variant)]">
      <p>
        {policy === 'autonomous'
          ? 'Go works through the stages and stops when it needs you. Finishing the project is always your click.'
          : 'Go works on its own and stops for your approval before important moves.'}{' '}
        Pressing Go is recorded on the decision trail.
      </p>
      {policy === 'autonomous' && onAutoWindows && (
        <label className="flex flex-wrap items-center gap-2">
          When a window of {budget} steps is used up, carry on for
          <select
            value={autoWindows}
            disabled={disabled}
            onChange={(e) => onAutoWindows(Number(e.target.value))}
            aria-label="Further windows without asking"
            className="rounded-md bg-[var(--surface-container-highest)] px-2 py-1 text-label text-[var(--on-surface)] disabled:opacity-60"
          >
            <option value={0}>no more windows</option>
            <option value={1}>1 more window</option>
            <option value={2}>2 more windows</option>
            <option value={3}>3 more windows</option>
            <option value={KEEP_GOING_WINDOWS}>up to {KEEP_GOING_WINDOWS} more windows</option>
          </select>
        </label>
      )}
      <details>
        <summary className="cursor-pointer">Everything Go may and may not do</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {POLICY_TERMS[policy].map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>{windowsLine(policy, budget, autoWindows)} You can press Stop at any time.</li>
        </ul>
      </details>
    </div>
  );
}

/** What happens when a window of steps is used up, as the choice below sets it. */
export function windowsLine(policy: Exclude<ExecutionPolicy, 'guided'>, budget: number, autoWindows: number): string {
  if (policy !== 'autonomous' || autoWindows <= 0) {
    return `It works in windows of ${budget} steps. When one is used up, Go stops and offers another; each further window is your click, and is recorded.`;
  }
  const n = autoWindows >= KEEP_GOING_WINDOWS ? `up to ${KEEP_GOING_WINDOWS}` : String(autoWindows);
  return `It works in windows of ${budget} steps, and you are authorising ${n} more window${autoWindows === 1 ? '' : 's'} now: when one is used up it starts the next without asking, each recorded. After that, a further window is your click.`;
}
