'use client';

import { useT } from '@/lib/i18n/i18n-provider';

import type { GoAlerts } from './use-go-alerts';

/** Turn the browser alert on or off. The browser's own permission is asked on this click. */
export function GoAlertsControl({ alerts }: { alerts: GoAlerts }) {
  const t = useT();
  if (alerts.permission === 'unsupported') return null;
  if (alerts.permission === 'denied') {
    return <p className="text-label text-[var(--on-surface-variant)]">{t('alert.denied')}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {alerts.on ? (
        <>
          <span className="inline-flex items-center gap-1 text-label text-[var(--on-surface)]">
            <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--pm-secondary)]">notifications_active</span>
            {t('alert.on')}
          </span>
          <button type="button" onClick={alerts.disable} className="text-label font-semibold text-[var(--pm-primary)]">
            {t('alert.off')}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => void alerts.enable()} className="inline-flex items-center gap-1 text-label font-semibold text-[var(--pm-primary)]">
          <span aria-hidden className="material-symbols-outlined text-[16px]">notifications</span>
          {t('alert.enable')}
        </button>
      )}
      <span className="basis-full text-label text-[var(--on-surface-variant)]">{t('alert.hint')}</span>
    </div>
  );
}
