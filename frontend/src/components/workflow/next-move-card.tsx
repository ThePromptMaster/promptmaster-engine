'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { shownActionLabel } from '@/lib/i18n/go';
import type { AgentStep } from '@/types/agent';

/**
 * PM-23: the next logical action, why, and one click to do it. The planner's
 * move is shown beside the stage's own next step, never instead of it.
 */
export function NextMoveCard({
  step,
  stale = false,
  label,
  effect,
  onDo,
  onReplan,
  onDismiss,
}: {
  step: AgentStep;
  /** Suggested before the stage last changed: its reasons may no longer hold. */
  stale?: boolean;
  /** The step's name on its stage (`stepActionLabel`). */
  label?: string;
  /** What doing it does, from the code (`whatApprovalDoes`). */
  effect?: string | null;
  onDo: () => void;
  onReplan?: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <section aria-label={t('pnl.suggestedLabel')} className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="flex items-center gap-1 text-label uppercase tracking-wide text-[var(--pm-primary)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">lightbulb</span>
        {t('pnl.suggests')}
      </p>
      <p className="mt-1 text-title text-[var(--on-surface)]">{label ?? shownActionLabel(step.action_key)}</p>
      {effect && <p data-effect className="mt-1 text-body text-[var(--on-surface)]">{t('pnl.whatItDoes', { effect })}</p>}
      {step.decision_question && <p className="mt-1 text-body text-[var(--on-surface)]">{step.decision_question}</p>}
      {step.rationale && <p className="mt-1 text-body text-[var(--on-surface)]">{t('pnl.why', { why: step.rationale })}</p>}
      {step.expected_outcome && <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">{t('pnl.goExpects', { what: step.expected_outcome })}</p>}
      {stale && (
        <p role="status" className="mt-2 text-label text-[var(--pm-tertiary)]">
          {t('pnl.staleSuggestion')}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {stale && onReplan ? (
          <button onClick={onReplan} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            {t('pnl.suggestAgain')}
          </button>
        ) : (
          <button onClick={onDo} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            {t('pnl.doIt')}
          </button>
        )}
        <button onClick={onDismiss} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          {t('pnl.notNow')}
        </button>
      </div>
    </section>
  );
}
