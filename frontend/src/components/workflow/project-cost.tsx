'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { shownCost } from '@/lib/observability/spent';
import { projectSpent, type CostKind } from '@/lib/supabase/project-cost';

const KINDS: readonly CostKind[] = ['first_draft', 'revision', 'review', 'repair', 'planning', 'chat', 'other'];

/**
 * What this project has cost so far (31 Oct). Read when the stage opens or the
 * project reloads; it does not tick while a call is running.
 */
export function ProjectCost({ projectId, refreshKey }: { projectId: string; refreshKey?: unknown }) {
  const t = useT();
  const [spent, setSpent] = useState<Awaited<ReturnType<typeof projectSpent>>>(null);
  useEffect(() => {
    let live = true;
    void projectSpent(projectId).then((s) => {
      if (live) setSpent(s);
    });
    return () => {
      live = false;
    };
  }, [projectId, refreshKey]);
  if (!spent || spent.calls === 0) return null;
  const cost = shownCost(spent.cost);
  const kinds = KINDS.filter((k) => (spent.byKind[k] ?? 0) > 0);
  return (
    <div className="px-1 text-label text-[var(--on-surface-variant)]">
      <p className="flex items-center gap-1.5" title={t('cost.projectHint')}>
        <span aria-hidden className="material-symbols-outlined text-[16px]">savings</span>
        {t('cost.project', { cost: cost ?? t('cost.unavailable') })}
        {cost && spent.unpriced > 0 ? ` ${t('cost.unpriced', { count: spent.unpriced })}` : ''}
        {spent.goCalls > 0 ? ` · ${t('cost.breakdown', { calls: spent.calls, goCalls: spent.goCalls, steps: spent.goSteps })}` : ''}
      </p>
      {kinds.length > 1 && (
        <details data-cost-kinds className="mt-1 ps-6">
          <summary className="cursor-pointer">{t('cost.whereItWent')}</summary>
          <ul className="mt-1 space-y-0.5">
            {kinds.map((k) => (
              <li key={k}>{t(`cost.kind.${k}` as const)}: {shownCost(spent.byKind[k] ?? 0)}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
