'use client';

import { useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import type { DecisionOffer } from '@/lib/workflow/decision-options';

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
  if (offer.loading) {
    return (
      <p data-decision-loading className="mt-3 text-label text-[var(--on-surface-variant)]">
        {t('nyc.optionsLoading')}
      </p>
    );
  }
  if (!offer.options.length) return null;
  return (
    <div data-decision-options className="mt-3">
      {offer.question && <p className="text-body text-[var(--on-surface)]">{offer.question}</p>}
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('nyc.chooseOne')}</p>
      <div className="mt-2 flex flex-col items-start gap-2">
        {offer.options.map((o) => (
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
        ))}
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
      <button
        type="button"
        disabled={busy || !other.trim()}
        onClick={() => onChoose(other.trim())}
        className="mt-2 rounded-lg bg-[var(--surface-container-low)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-50"
      >
        {recordLabel}
      </button>
    </div>
  );
}
