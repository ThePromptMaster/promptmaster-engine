'use client';

import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { eligibleOptions, failingChoice, type DecisionOffer, type DecisionOption } from '@/lib/workflow/decision-options';

/**
 * An option the stage's own text shows failing one of the user's requirements
 * (L-274): explained in place of a button. 22 Nov, Sean: "Option A … (over the
 * $50,000 cap)" was a button like B, and pressing it was recorded.
 */
export function FailingOption({ option }: { option: DecisionOption }) {
  const t = useT();
  if (!option.fails) return null;
  return (
    <div data-option-fails className="flex items-start gap-2 rounded-lg bg-[var(--surface-container)] px-4 py-2 text-start" title={option.quote}>
      <span className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]" aria-hidden>block</span>
      <span className="min-w-0">
        <span className="block text-title text-[var(--on-surface-variant)]">{option.label}</span>
        <span className="block text-label text-[var(--on-surface-variant)]">
          {t('nyc.optionFails', { requirement: option.fails.requirement, quote: option.fails.quote })} {t('nyc.changeRequirement')}
        </span>
      </span>
    </div>
  );
}

/**
 * The options a reserved approval offers, each a button, and a box for a
 * decision that is none of them (12 Nov: "Where am I supposed to select A?").
 * Choosing one is the approval: the page records which, and the stage is
 * updated to say so. Shown on Go's card and under the approval on the stage.
 */
export function DecisionChoices({
  offer,
  busy = false,
  onChoose,
  recordLabel,
}: {
  offer: DecisionOffer;
  busy?: boolean;
  onChoose: (choice: string) => void;
  /** The typed decision's button: "Record my decision and resume" on Go's card. */
  recordLabel: string;
}) {
  const t = useT();
  const [other, setOther] = useState('');
  const [refused, setRefused] = useState('');
  if (offer.loading) {
    return (
      <p data-decision-loading className="mt-3 text-label text-[var(--on-surface-variant)]">
        {t('nyc.optionsLoading')}
      </p>
    );
  }
  if (!offer.options.length) return null;
  const eligible = eligibleOptions(offer.options);
  const sendTyped = () => {
    const text = other.trim();
    // Typed, an option the text shows failing a requirement is refused too (L-274).
    const failing = failingChoice(text, offer.options);
    if (failing?.fails) {
      setRefused(t('nyc.typedFails', { option: failing.label, requirement: failing.fails.requirement, quote: failing.fails.quote }));
      return;
    }
    setRefused('');
    onChoose(text);
  };
  return (
    <div data-decision-options className="mt-3">
      {offer.question && <p className="text-body text-[var(--on-surface)]">{offer.question}</p>}
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{eligible.length ? t('nyc.chooseOne') : t('nyc.noneEligible')}</p>
      <div className="mt-2 flex flex-col items-start gap-2">
        {offer.options.map((o) =>
          o.fails ? (
            <FailingOption key={o.label} option={o} />
          ) : (
            <button
              key={o.label}
              type="button"
              title={o.quote}
              disabled={busy}
              onClick={() => onChoose(o.label)}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-start text-title text-[var(--on-primary)] disabled:opacity-50"
            >
              {o.label}
            </button>
          )
        )}
      </div>
      <label className="mt-3 block">
        <span className="text-label text-[var(--on-surface-variant)]">{t('nyc.somethingElse')}</span>
        <textarea
          data-decision-other
          value={other}
          onChange={(e) => setOther(e.target.value)}
          disabled={busy}
          rows={2}
          maxLength={400}
          className="mt-1 w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] disabled:opacity-50"
        />
      </label>
      {refused && (
        <p data-decision-refused role="alert" className="mt-2 text-label text-[var(--pm-error)]">
          {refused}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !other.trim()}
        onClick={sendTyped}
        className="mt-2 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-50"
      >
        {recordLabel}
      </button>
    </div>
  );
}
