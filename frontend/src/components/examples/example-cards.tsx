'use client';

import Link from 'next/link';

import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { EXAMPLE_CARDS, exampleHref } from '@/lib/projects/examples/cards';

/**
 * The curated examples as a menu (the client's call, 4 Nov). Links, never
 * buttons that do anything: a card opens the example's preview, which says what
 * it is and what uses credit before anything is created.
 */
export function ExampleCards({ compact = false }: { compact?: boolean }) {
  const t = useT();
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {EXAMPLE_CARDS.map((card) => (
        <li key={card.key}>
          <Link
            href={exampleHref(card.slug)}
            className={`flex h-full gap-3 rounded-2xl bg-[var(--surface-container-low)] text-start transition-colors hover:bg-[var(--surface-container-high)] ${compact ? 'items-center px-4 py-3' : 'px-5 py-4'}`}
          >
            <span aria-hidden className="material-symbols-outlined text-[22px] text-[var(--pm-primary)]">{card.icon}</span>
            <span className="min-w-0">
              <span className="block text-title text-[var(--on-surface)]">{t(`ex.${card.key}.title` as MessageKey)}</span>
              {!compact && <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t(`ex.${card.key}.blurb` as MessageKey)}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
