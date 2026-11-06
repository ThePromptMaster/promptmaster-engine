'use client';

import Link from 'next/link';

import { useT } from '@/lib/i18n/i18n-provider';

import { useConnectionsAllowed } from './use-connections-allowed';

/** The way to connecting an account, offered only to someone on the pilot list. */
export function ConnectOffer() {
  const t = useT();
  const allowed = useConnectionsAllowed();
  if (!allowed) return null;
  return (
    <Link href="/projects/connect" className="flex gap-3 rounded-2xl bg-[var(--surface-container-low)] px-5 py-4 text-start transition-colors hover:bg-[var(--surface-container-high)]">
      <span aria-hidden className="material-symbols-outlined text-[22px] text-[var(--pm-primary)]">event_available</span>
      <span className="min-w-0">
        <span className="block text-title text-[var(--on-surface)]">{t('conn.offer')}</span>
        <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{t('conn.offerNote')}</span>
      </span>
    </Link>
  );
}
