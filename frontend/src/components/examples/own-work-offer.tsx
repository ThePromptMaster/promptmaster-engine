'use client';

import Link from 'next/link';

import { useT } from '@/lib/i18n/i18n-provider';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';

/**
 * When an example finishes, the next step (`docs/assessments/2026-11-06-first-engagement.md`):
 * the moment it has made its case is the moment nothing asked for one. Starting their own
 * project is what shows it taught them something. Only links; a project that is not an
 * example, or one whose example has gone, shows nothing.
 */
export function OwnWorkOffer({ exampleKey }: { exampleKey?: string | null }) {
  const t = useT();
  const card = EXAMPLE_CARDS.find((c) => c.key === exampleKey);
  if (!card) return null;
  return (
    <div role="region" aria-label={t('ex.finishedOwnTitle')} className="mt-6 rounded-xl bg-[var(--surface-container-lowest)] px-5 py-4">
      <h3 className="text-title text-[var(--on-surface)]">{t('ex.finishedOwnTitle')}</h3>
      <p className="mt-1 text-body text-[var(--on-surface-variant)]">{t('ex.finishedOwnLead')}</p>
      <Link
        href={`${exampleHref(card.slug)}#own`}
        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-4 py-2 text-label font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90"
      >
        {t('ex.finishedOwnAction')}
        <span aria-hidden className="material-symbols-outlined text-[18px] rtl:-scale-x-100">arrow_forward</span>
      </Link>
    </div>
  );
}
