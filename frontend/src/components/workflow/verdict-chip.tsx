'use client';

/**
 * A verdict on the user's scale, as a coloured chip (Assess, 25 Oct). The
 * colour comes from the level's tone, never from its name, so "Strong fit",
 * "4" and "Green" read alike; the words are always on it, so colour is never
 * the only signal.
 */

import type { VerdictTone } from '@/lib/workflow/assess';

const TONE: Record<VerdictTone, string> = {
  good: 'bg-[var(--success-container)] text-[var(--on-success-container)]',
  caution: 'bg-[var(--caution-container)] text-[var(--on-caution-container)]',
  bad: 'bg-[var(--error-container)] text-[var(--on-error-container)]',
  neutral: 'bg-[var(--surface-container-high)] text-[var(--on-surface-variant)]',
};

const DOT: Record<VerdictTone, string> = {
  good: 'bg-[var(--pm-success)]',
  caution: 'bg-[#b07d00]',
  bad: 'bg-[var(--pm-error)]',
  neutral: 'bg-[var(--outline)]',
};

export function VerdictChip({ label, tone, count }: { label: string; tone: VerdictTone; count?: number }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-label font-semibold ${TONE[tone]}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="tabular-nums opacity-80">{count}</span>}
    </span>
  );
}
