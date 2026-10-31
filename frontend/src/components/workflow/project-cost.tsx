'use client';

import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';
import { shownCost } from '@/lib/observability/spent';
import { projectSpent } from '@/lib/supabase/project-cost';

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
  return (
    <p className="flex items-center gap-1.5 px-1 text-label text-[var(--on-surface-variant)]" title={t('cost.projectHint')}>
      <span aria-hidden className="material-symbols-outlined text-[16px]">savings</span>
      {t('cost.project', { cost: cost ?? t('cost.unavailable') })}
      {cost && spent.unpriced > 0 ? ` ${t('cost.unpriced', { count: spent.unpriced })}` : ''}
    </p>
  );
}
