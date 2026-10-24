'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { ExecutionPolicy } from '@/types/agent';

const POLICIES: ExecutionPolicy[] = ['guided', 'checkpoint', 'autonomous'];

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
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('pol.label')} className="grid gap-2 sm:grid-cols-3">
      {POLICIES.map((value) => ({ value, label: t(`pol.${value}`), hint: t(`pol.${value}Hint`) })).map((p) => (
        <button
          key={p.value}
          role="radio"
          aria-checked={value === p.value}
          disabled={disabled}
          onClick={() => onChange(p.value)}
          className={`rounded-lg px-3 py-2 text-start transition-colors disabled:opacity-60 ${
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
