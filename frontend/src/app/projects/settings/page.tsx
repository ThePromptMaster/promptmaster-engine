'use client';

import Link from 'next/link';

import { ConnectedAccounts } from '@/components/personalize/connected-accounts';
import { useT } from '@/lib/i18n/i18n-provider';

/** Connected accounts (the client's call, 7 Nov): what each reads, and connecting or disconnecting it. */
export default function SettingsPage() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-display text-[var(--on-surface)]">{t('conn.settingsTitle')}</h1>
      <p className="mt-3 text-body text-[var(--on-surface-variant)]">{t('conn.settingsLead')}</p>
      <p className="mt-3 text-label text-[var(--on-surface-variant)]">{t('conn.composioNote')}</p>
      <div className="mt-6">
        <ConnectedAccounts returnTo="/projects/settings" />
      </div>
      <Link
        href="/projects/from-accounts"
        className="mt-6 inline-flex items-center gap-1 text-body font-medium text-[var(--pm-primary)] hover:underline"
      >
        {t('conn.useThem')}
        <span aria-hidden className="material-symbols-outlined text-[18px] rtl:-scale-x-100">arrow_forward</span>
      </Link>
    </main>
  );
}
