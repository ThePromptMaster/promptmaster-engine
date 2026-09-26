'use client';

import { useEffect, useRef } from 'react';

import type { PanelStepReporter, ReportedPanelStep } from '@/lib/workflow/next-action';

/**
 * Report a panel's next step to the workspace (PM-06).
 *
 * The step's action is read through a ref, so the report only changes when
 * what the button would SAY changes — not on every render — and unmounting
 * withdraws it, so a stage never shows the previous stage's step.
 */
export function useReportPanelStep(
  report: PanelStepReporter | undefined,
  stageId: string,
  step: ReportedPanelStep | null
) {
  const run = useRef(step?.run);
  const latestRun = step?.run;
  useEffect(() => {
    run.current = latestRun;
  });

  const label = step?.label ?? null;
  const reason = step?.reason ?? '';
  const busy = Boolean(step?.busy);
  const present = step !== null;

  useEffect(() => {
    if (!report) return;
    report(
      stageId,
      present ? { label: label ?? '', reason, busy, run: () => run.current?.() } : null
    );
  }, [report, stageId, present, label, reason, busy]);

  useEffect(() => () => report?.(stageId, null), [report, stageId]);
}
