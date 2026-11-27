'use client';

/**
 * Written, checked, approved, and still open in the world, on one line, when they differ
 * (L-321; Sean, 27 Nov: "I'd like the UI to make that easy to see whenever those statuses differ").
 */

import { useT } from '@/lib/i18n/i18n-provider';
import type { StageStatusSummary as Line } from '@/lib/workflow/stage-status';

export function StageStatusLine({ line }: { line: Line | null }) {
  const t = useT();
  if (!line) return null;
  const parts = [
    t('sst.written', { n: line.written }),
    line.checked === null ? t('sst.notChecked') : t('sst.checked', { n: line.checked }),
    line.approved === null ? null : t('sst.approved', { n: line.approved }),
  ].filter((p): p is string => Boolean(p));
  return (
    <p data-stage-status className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-[var(--on-surface-variant)]">
      <span aria-hidden className="material-symbols-outlined text-[16px]">fact_check</span>
      {parts.map((p, i) => (
        <span key={p} className={i === 0 ? 'text-[var(--on-surface)]' : undefined}>{i > 0 ? '· ' : ''}{p}</span>
      ))}
      {line.openInWorld.length > 0 && (
        <span className="text-[var(--on-surface)]">
          · {t('sst.openInWorld', { what: line.openInWorld.join('; ') })}{line.openMore > 0 ? ` ${t('sst.andMore', { count: line.openMore })}` : ''}
        </span>
      )}
    </p>
  );
}
