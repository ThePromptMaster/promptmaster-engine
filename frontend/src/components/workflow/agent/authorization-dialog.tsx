'use client';

import type { MessageKey } from '@/lib/i18n/messages/en';
import { tr } from '@/lib/i18n/store';
import { useT } from '@/lib/i18n/i18n-provider';
import { KEEP_GOING_WINDOWS, POLICY_TERMS } from '@/lib/agent/authorize';
import type { ExecutionPolicy } from '@/types/agent';

/**
 * What Go may do, said once beside the button (17 Oct, Sean: "the directions
 * are a little too wordy for the authorized button … somebody just felt
 * paralyzed"). Pressing Go with Checkpoint or Autonomous is the authorization:
 * it is recorded on the decision trail (an accepted proposal plus a decision)
 * and the database checks every autonomous stage move against it. The full
 * terms are one click away rather than a dialog in the way.
 */
export function GoTerms({
  policy,
  budget,
  autoWindows = 0,
  onAutoWindows,
  disabled = false,
}: {
  policy: Exclude<ExecutionPolicy, 'guided'>;
  budget: number;
  /** Further windows the run may start on its own. Offered for Autonomous only. */
  autoWindows?: number;
  onAutoWindows?: (n: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div aria-label={t('gt.label')} className="space-y-2 text-label text-[var(--on-surface-variant)]">
      <p>
        {policy === 'autonomous'
          ? t('gt.auto')
          : t('gt.checkpoint')}{' '}
        {t('gt.recorded')}
      </p>
      {policy === 'autonomous' && onAutoWindows && (
        <label className="flex flex-wrap items-center gap-2">
          {t('gt.carryOn', { budget })}
          <select
            value={autoWindows}
            disabled={disabled}
            onChange={(e) => onAutoWindows(Number(e.target.value))}
            aria-label={t('gt.further')}
            className="rounded-md bg-[var(--surface-container-highest)] px-2 py-1 text-label text-[var(--on-surface)] disabled:opacity-60"
          >
            <option value={0}>{t('gt.none')}</option>
            <option value={1}>{t('gt.one')}</option>
            <option value={2}>{t('gt.two')}</option>
            <option value={3}>{t('gt.three')}</option>
            <option value={KEEP_GOING_WINDOWS}>{t('gt.upTo', { count: KEEP_GOING_WINDOWS })}</option>
          </select>
        </label>
      )}
      <details>
        <summary className="cursor-pointer">{t('gt.everything')}</summary>
        <ul className="mt-1 list-disc space-y-1 ps-5">
          {/* The recorded terms stay in English on the authorization; these are the same words, shown. */}
          {POLICY_TERMS[policy].map((term, i) => (
            <li key={term}>{t(`gt.term.${policy}.${i}` as MessageKey)}</li>
          ))}
          <li>{windowsLine(policy, budget, autoWindows)} {t('gt.stopAnytime')}</li>
        </ul>
      </details>
    </div>
  );
}

/** What happens when a window of steps is used up, as the choice below sets it. */
export function windowsLine(policy: Exclude<ExecutionPolicy, 'guided'>, budget: number, autoWindows: number): string {
  if (policy !== 'autonomous' || autoWindows <= 0) {
    return tr('gt.windowsAsk', { budget });
  }
  const n = autoWindows >= KEEP_GOING_WINDOWS ? tr('gt.upToN', { count: KEEP_GOING_WINDOWS }) : String(autoWindows);
  return tr('gt.windowsAuto', { count: autoWindows, budget, n });
}
