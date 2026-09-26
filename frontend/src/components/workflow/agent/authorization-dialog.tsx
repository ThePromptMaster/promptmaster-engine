'use client';

import { POLICY_TERMS } from '@/lib/agent/authorize';
import type { ExecutionPolicy } from '@/types/agent';

/**
 * Checkpoint and Autonomous act without asking each time, so they start with
 * an explicit authorization that is recorded (an accepted proposal plus a
 * decision) and that the database checks every autonomous stage move against.
 */
export function AuthorizationDialog({
  policy,
  budget,
  onAuthorize,
  onCancel,
}: {
  policy: Exclude<ExecutionPolicy, 'guided'>;
  budget: number;
  onAuthorize: () => void;
  onCancel: () => void;
}) {
  return (
    <section
      role="dialog"
      aria-label="Authorize Go mode"
      className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4"
    >
      <h3 className="text-title text-[var(--on-surface)]">
        Let Go mode run {policy === 'autonomous' ? 'autonomously' : 'with checkpoints'}?
      </h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-body text-[var(--on-surface)]">
        {POLICY_TERMS[policy].map((t) => (
          <li key={t}>{t}</li>
        ))}
        <li>At most {budget} steps. You can press Stop at any time.</li>
      </ul>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        This authorization is recorded on the project&apos;s decision trail.
      </p>
      <div className="mt-3 flex gap-2">
        <button onClick={onAuthorize} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
          Authorize and go
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          Cancel
        </button>
      </div>
    </section>
  );
}
