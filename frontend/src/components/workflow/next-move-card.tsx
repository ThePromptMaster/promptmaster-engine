'use client';

import { actionLabel } from '@/lib/agent/actions';
import type { AgentStep } from '@/types/agent';

/**
 * PM-23: the next logical action, why, and one click to do it. The planner's
 * move is shown beside the stage's own next step, never instead of it.
 */
export function NextMoveCard({
  step,
  onDo,
  onDismiss,
}: {
  step: AgentStep;
  onDo: () => void;
  onDismiss: () => void;
}) {
  return (
    <section aria-label="Suggested next move" className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="flex items-center gap-1 text-label uppercase tracking-wide text-[var(--pm-primary)]">
        <span aria-hidden className="material-symbols-outlined text-[16px]">lightbulb</span>
        PromptMaster suggests
      </p>
      <p className="mt-1 text-title text-[var(--on-surface)]">{actionLabel(step.action_key)}</p>
      {step.decision_question && <p className="mt-1 text-body text-[var(--on-surface)]">{step.decision_question}</p>}
      {step.rationale && <p className="mt-1 text-body text-[var(--on-surface)]">Why: {step.rationale}</p>}
      {step.expected_outcome && <p className="mt-0.5 text-label text-[var(--on-surface-variant)]">You get: {step.expected_outcome}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={onDo} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
          Do it
        </button>
        <button onClick={onDismiss} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Not now
        </button>
      </div>
    </section>
  );
}
