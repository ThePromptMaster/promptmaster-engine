'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import type { ReadinessRow } from '@/lib/workflow/readiness';

/** Written, Checked, Approved and Ready, each with the version it holds for (8 Nov). */
export function DeliverableReadiness({ rows }: { rows: readonly ReadinessRow[] }) {
  const t = useT();
  const value = (r: ReadinessRow) => {
    if (r.state === 'none') return t('ready.notAsked');
    if (r.earlier !== undefined) return t('ready.earlier', { earlier: r.earlier, current: r.version ?? '' });
    if (r.state === 'open') return r.detail ?? t('ready.notYet');
    return r.key === 'ready' && r.version === undefined ? t('ready.yes') : t('ready.version', { n: r.version ?? '' });
  };
  return (
    <section aria-label={t('ready.label')} className="grid grid-cols-1 gap-2 rounded-xl bg-[var(--surface-container-low)] px-5 py-4 sm:grid-cols-4">
      {rows.map((r) => (
        <div key={r.key} data-readiness={r.key} data-state={r.state} className="flex items-start gap-2">
          <span
            aria-hidden
            className={`material-symbols-outlined text-[18px] ${r.state === 'done' ? 'text-[var(--pm-secondary)]' : 'text-[var(--on-surface-variant)]'}`}
          >
            {r.state === 'done' ? 'check_circle' : r.state === 'none' ? 'remove' : 'radio_button_unchecked'}
          </span>
          <div className="min-w-0">
            <p className="text-label font-semibold text-[var(--on-surface)]">{t(`ready.${r.key}` as const)}</p>
            <p className="text-label text-[var(--on-surface-variant)]">{value(r)}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
