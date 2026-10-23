'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import { describeNeed, needIsDecidedOnStage, type NeedContext, type NeedsUser, type StuckOption } from '@/lib/agent/needs';

/**
 * "I need you to do this before I can continue" — with that exact action
 * right there (B4, Sean 28 Sep item 4). One card, one button; the bare
 * Resume is hidden while it shows, so Resume can never re-trip the same stop.
 */
export function NeedsYouCard({
  need,
  stageLabel,
  onAction,
  context,
  onCarryOn,
}: {
  need: NeedsUser;
  /**
   * Q2c (9 Oct, production): an approval Go stopped for may not be the only
   * thing left. "Carry on with other work first" resumes the run; Go checks
   * again whether anything can proceed without the approval, and asks again
   * — at no cost — only if nothing can.
   */
  onCarryOn?: () => void;
  stageLabel: (stageId: string) => string;
  /** Clear the need and resume. Rejects with a message the card shows. A stuck stage says which of its options was chosen. */
  onAction: (option?: StuckOption) => Promise<void>;
  context?: NeedContext;
}) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { message, action, options, footer } = describeNeed(need, stageLabel, context, locale);
  const run = (option?: StuckOption) => {
    setBusy(true);
    setError(null);
    onAction(option)
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : t('nyc.failed')))
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label={t('nyc.label')} className="rounded-xl bg-[var(--surface-container-highest)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{need.kind === 'skip_stage' || need.kind === 'next_round' ? t('nyc.suggestion') : t('nyc.needYou')}</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">{message}</p>
      {options ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {options.map((o, i) => (
            <button
              key={o.id}
              onClick={() => run(o.id)}
              disabled={busy}
              className={
                i === 0
                  ? 'rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-50'
                  : 'rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-50'
              }
            >
              {busy && i === 0 ? t('nyc.working') : o.label}
            </button>
          ))}
          {footer && <span className="basis-full text-label text-[var(--on-surface-variant)]">{footer}</span>}
        </div>
      ) : action ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={() => run()}
            disabled={busy}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
          >
            {busy ? t('nyc.working') : action}
          </button>
          <span className="text-label text-[var(--on-surface-variant)]">
            {need.kind === 'next_round'
              ? t('nyc.orWriteUp')
              : need.kind === 'skip_stage'
              ? t('nyc.orResume')
              : needIsDecidedOnStage(need)
                ? t('nyc.decideThere')
                : t('nyc.orYourself')}
          </span>
          {onCarryOn && (
            <button
              onClick={onCarryOn}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-50"
            >
              {t('nyc.carryOn')}
            </button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('nyc.thenResume')}</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-label text-[var(--pm-tertiary)]">
          {error}
        </p>
      )}
    </section>
  );
}
