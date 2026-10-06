'use client';

import type { RoutineDecisions as Policy } from '@/types/project';

const OPTIONS: { value: Policy; label: string; hint: string }[] = [
  {
    value: 'handle',
    label: 'Handle them for me',
    hint: 'Checks routine work, accepts justified revisions and continues within your objective. Asks when a decision needs your judgment.',
  },
  { value: 'ask', label: 'Ask me', hint: 'Every approval waits for you.' },
];

/**
 * Who may decide a routine approval (Sean, 5 Oct). Separate from how
 * autonomously Go runs: the involvement mode says when Go pauses, this says
 * whether an approval it can check may be committed without you. Reserved
 * approvals — choosing, accepting, approving for use or execution — are always
 * yours. Changing it applies at once, to work already under way too.
 */
export function RoutineDecisions({ value, onChange, disabled = false }: { value: Policy; onChange: (v: Policy) => void; disabled?: boolean }) {
  return (
    <div>
      <p id="routine-decisions-label" className="mb-1.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
        Routine decisions
      </p>
      <div role="radiogroup" aria-labelledby="routine-decisions-label" className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => value !== o.value && onChange(o.value)}
            className={`rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-60 ${
              value === o.value
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
            }`}
          >
            <span className="block text-label font-semibold">{o.label}</span>
            <span className="block text-label opacity-80">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
