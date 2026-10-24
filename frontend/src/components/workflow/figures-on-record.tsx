'use client';

import { useMemo } from 'react';
import { useT } from '@/lib/i18n/i18n-provider';

import { establishedFigures, type StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';

/**
 * The figures the project has on record: what each completed stage
 * established, exactly as it wrote it. These are what later stages are told
 * to quote rather than work out again (1 Oct, item 32), shown so the user can
 * see what "the canonical numbers" are. Nothing here is computed.
 */
export function FiguresOnRecord({
  template,
  state,
  bundles,
}: {
  template: WorkflowTemplate;
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
}) {
  const t = useT();
  // Every done stage, whichever one is on screen: the record is the project's.
  const figures = useMemo(() => establishedFigures(template, state, bundles, ''), [template, state, bundles]);
  if (figures.length === 0) return null;
  return (
    <details aria-label={t('pnl.figuresLabel')} className="group mb-6 rounded-xl bg-[var(--surface-container-lowest)] px-7 py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-body text-[var(--on-surface-variant)]">
        <span aria-hidden className="material-symbols-outlined rtl:-scale-x-100 text-[18px] transition-transform group-open:rotate-90">chevron_right</span>
        <span className="text-label uppercase tracking-wider">{t('pnl.figuresTitle', { n: figures.length })}</span>
      </summary>
      <p className="mt-3 text-label text-[var(--on-surface-variant)]">
        {t('pnl.figuresNote')}
      </p>
      <ul className="mt-3 space-y-1.5">
        {figures.map((f, i) => (
          <li key={`${f.stage}:${f.name}:${i}`} className="text-body text-[var(--on-surface)]">
            <span className="font-semibold">{f.value}</span> — {f.name}
            <span className="text-label text-[var(--on-surface-variant)]"> · {f.stage}{f.context ? ` · ${f.context}` : ''}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
