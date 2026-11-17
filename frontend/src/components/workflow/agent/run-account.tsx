'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { runAccount } from '@/lib/agent/account';
import type { AgentRun, AgentStep } from '@/types/agent';

const ICON: Record<string, string> = {
  working: 'autorenew', window: 'hourglass_bottom', blocker: 'block', decision: 'front_hand', complete: 'task_alt', stopped: 'pause_circle',
};

/**
 * Q3c — what Go did, what it is doing, or exactly why it paused, in three
 * lines above the detailed record (Sean, 9 Oct). Derived from the steps.
 */
export function RunAccountCard({
  run,
  steps,
  stageLabel,
  stageByEnglish,
  choosing = false,
  left,
}: {
  run: AgentRun | null;
  steps: readonly AgentStep[];
  stageLabel: (id: string) => string;
  stageByEnglish?: (english: string) => string;
  /** The waiting approval is given by choosing an option on its card. */
  choosing?: boolean;
  /** What Go could still do, and how many things wait on the user (17 Nov). */
  left?: { forGo: readonly { kind: 'recheck' | 'finish'; stageId: string }[]; forYou: number };
}) {
  const t = useT();
  const locale = useLocale();
  const account = runAccount(run, steps, stageLabel, locale, stageByEnglish, choosing, left?.forYou ?? 0);
  if (!account || (!account.did && account.kind === 'working')) return null;
  return (
    <section aria-label={t('acc.label')} data-kind={account.kind} className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <p className="flex items-start gap-2 text-title text-[var(--on-surface)]">
        <span aria-hidden className="material-symbols-outlined text-[20px]">{ICON[account.kind]}</span>
        <span>{account.now}</span>
      </p>
      {account.did && <p className="mt-2 text-body text-[var(--on-surface)]"><span className="text-[var(--on-surface-variant)]">{t('acc.soFar')}</span>{account.did}</p>}
      {left && account.kind !== 'working' && account.kind !== 'complete' && (
        <p className="mt-2 text-body text-[var(--on-surface)]" data-testid="run-left">
          {left.forGo.length
            ? t('acct.leftForGo', { work: left.forGo.slice(0, 6).map((w) => t(w.kind === 'recheck' ? 'acct.recheckStage' : 'acct.finishStage', { stage: stageLabel(w.stageId) })).join(', ') + (left.forGo.length > 6 ? '…' : '') })
            : t('acct.nothingForGo')}
          {left.forYou > 0 ? ` ${t('acct.waitingOnYou', { count: left.forYou })}` : ''}
        </p>
      )}
      {account.setAside.length > 0 && (
        <ul className="mt-2 list-disc ps-5 text-body text-[var(--on-surface-variant)]">
          {account.setAside.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </section>
  );
}
