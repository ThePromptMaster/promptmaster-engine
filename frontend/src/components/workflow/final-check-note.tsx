'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { FinalCheckState } from '@/lib/workflow/final-check';

const ICON: Record<FinalCheckState['status'], string> = {
  checking: 'progress_activity', clean: 'verified', corrected: 'auto_fix_high', open: 'rule', failed: 'error',
};

/**
 * What the final check did to a one-stage project's draft (11 Nov): said in one
 * line, with what it corrected and what it left listed, so a second version
 * never appears unexplained.
 */
export function FinalCheckNote({ state }: { state: FinalCheckState | null }) {
  const t = useT();
  if (!state) return null;
  const fixed = state.status === 'corrected' || state.status === 'open' ? state.fixed : [];
  const left = state.status === 'open' ? state.left : [];
  const line =
    state.status === 'corrected' ? t('fc.corrected', { count: fixed.length })
    : state.status === 'open' ? t('fc.open')
    : t(`fc.${state.status}`);
  return (
    <div role="status" data-final-check={state.status} className="mb-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-label text-[var(--on-surface-variant)]">
      <p className="flex items-start gap-1.5">
        <span aria-hidden className={`material-symbols-outlined text-[16px] ${state.status === 'checking' ? 'animate-spin' : ''}`}>{ICON[state.status]}</span>
        <span className="flex-1">{line}</span>
      </p>
      {fixed.length > 0 && (
        <details className="mt-1 ps-6">
          <summary className="cursor-pointer">{t('fc.fixedTitle')}</summary>
          <ul className="mt-1 list-disc space-y-1 ps-4">{fixed.map((f) => <li key={f}>{f}</li>)}</ul>
        </details>
      )}
      {left.length > 0 && (
        <div className="mt-1 ps-6">
          <p className="font-semibold text-[var(--on-surface)]">{t('fc.leftTitle')}</p>
          <ul className="mt-1 list-disc space-y-1 ps-4">{left.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
