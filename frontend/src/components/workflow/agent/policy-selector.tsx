'use client';

import type { ExecutionPolicy } from '@/types/agent';

const POLICIES: { value: ExecutionPolicy; label: string; hint: string }[] = [
  { value: 'guided', label: 'Guided', hint: 'Proposes one move at a time; you approve each' },
  { value: 'checkpoint', label: 'Checkpoint', hint: 'Works on its own, stops at important decisions' },
  { value: 'autonomous', label: 'Autonomous', hint: 'Works until done, stuck, or it needs you' },
];

/** PM-18: how autonomously Go continues — chosen, not implied. */
export function PolicySelector({
  value,
  onChange,
  disabled,
}: {
  value: ExecutionPolicy;
  onChange: (p: ExecutionPolicy) => void;
  disabled: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="How autonomously Go runs" className="grid gap-2 sm:grid-cols-3">
      {POLICIES.map((p) => (
        <button
          key={p.value}
          role="radio"
          aria-checked={value === p.value}
          disabled={disabled}
          onClick={() => onChange(p.value)}
          className={`rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-60 ${
            value === p.value
              ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
              : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]'
          }`}
        >
          <span className="block text-label font-semibold">{p.label}</span>
          <span className="block text-label opacity-80">{p.hint}</span>
        </button>
      ))}
    </div>
  );
}
