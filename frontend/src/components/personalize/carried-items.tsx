'use client';

import { shortWhen } from '@/lib/connections/items';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { ThirdPartyItem } from '@/types';

const ICON: Record<ThirdPartyItem['kind'], string> = { email: 'mail', calendar_event: 'event', file: 'description' };

/**
 * The items "Start this" carried from the person's accounts (7 Nov), on the start
 * screen: they go into the project when it is made, as other people's words, and
 * each can be dropped first. The conversation sees their titles only.
 */
export function CarriedItems({
  items,
  onRemove,
  disabled = false,
}: {
  items: readonly ThirdPartyItem[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  if (!items.length) return null;
  return (
    <section aria-label={t('conn.carriedTitle')} className="mt-3 rounded-lg bg-[var(--surface-container-low)] px-3 py-2">
      <p className="text-label font-semibold text-[var(--on-surface)]">{t('conn.carriedTitle')}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={`${i}-${item.title}`} className="flex items-center gap-2 text-label text-[var(--on-surface)]">
            <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--on-surface-variant)]">{ICON[item.kind]}</span>
            <span dir="auto" className="min-w-0 flex-1 truncate">
              {item.title}
              {item.when ? <span className="text-[var(--on-surface-variant)]"> · {shortWhen(item.when, locale)}</span> : null}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(i)}
              aria-label={t('conn.carriedRemove', { title: item.title })}
              className="shrink-0 rounded p-0.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('conn.carriedNote')}</p>
    </section>
  );
}
