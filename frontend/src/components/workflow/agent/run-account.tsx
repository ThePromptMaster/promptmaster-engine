'use client';

import { runAccount } from '@/lib/agent/account';
import type { AgentRun, AgentStep } from '@/types/agent';

const ICON: Record<string, string> = {
  working: 'autorenew', window: 'hourglass_bottom', blocker: 'block', decision: 'front_hand', complete: 'task_alt', stopped: 'pause_circle',
};

/**
 * Q3c — what Go did, what it is doing, or exactly why it paused, in three
 * lines above the detailed record (Sean, 9 Oct). Derived from the steps.
 */
export function RunAccountCard({ run, steps, stageLabel }: { run: AgentRun | null; steps: readonly AgentStep[]; stageLabel: (id: string) => string }) {
  const account = runAccount(run, steps, stageLabel);
  if (!account || (!account.did && account.kind === 'working')) return null;
  return (
    <section aria-label="What Go has done" data-kind={account.kind} className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p className="flex items-start gap-2 text-title text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[20px]">{ICON[account.kind]}</span>
        <span>{account.now}</span>
      </p>
      {account.did && <p className="mt-2 text-body text-[var(--on-surface)]"><span className="text-[var(--on-surface-variant)]">So far: </span>{account.did}</p>}
      {account.setAside.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-body text-[var(--on-surface-variant)]">
          {account.setAside.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  );
}
