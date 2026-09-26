'use client';

import { LABEL_TEXT } from '@/lib/agent/labels';
import type { ExecutionLabel } from '@/types/agent';

/**
 * PM-12's distinction, on every agent step: was anything actually run?
 * "Reasoned" and "Executed" are drawn differently on purpose — the difference
 * is the point, so it must not depend on reading the words.
 */
export function ExecutionBadge({ label }: { label: ExecutionLabel | null }) {
  if (!label) return null;
  const { text, executed } = LABEL_TEXT[label];
  const blocked = label === 'blocked';
  return (
    <span
      data-execution-label={label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${
        blocked
          ? 'bg-[var(--pm-tertiary)]/15 text-[var(--pm-tertiary)]'
          : executed
            ? 'bg-[var(--pm-secondary)]/15 text-[var(--pm-secondary)]'
            : 'bg-[var(--surface-container-highest)] text-[var(--on-surface-variant)]'
      }`}
    >
      <span aria-hidden className="material-symbols-outlined text-[0.9rem]">
        {blocked ? 'block' : executed ? 'terminal' : 'psychology'}
      </span>
      {text}
    </span>
  );
}
