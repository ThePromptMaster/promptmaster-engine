'use client';

import { counterText } from '@/lib/projects/input-limits';

/** "57,210 / 60,000" under a field, once the limit is in sight; nothing before. */
export function LimitCounter({ length, limit }: { length: number; limit: number }) {
  const text = counterText(length, limit);
  if (!text) return null;
  const full = length >= limit;
  return (
    <p
      role={full ? 'status' : undefined}
      className={`mt-1 text-right text-label ${full ? 'text-[var(--pm-error)]' : 'text-[var(--outline)]'}`}
    >
      {text}
    </p>
  );
}
