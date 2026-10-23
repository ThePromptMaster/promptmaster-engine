'use client';

import { tr } from '@/lib/i18n/store';
import { useEffect, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { shownStepLabel as stepLabel } from '@/lib/i18n/go';
import { collapseSteps } from '@/lib/agent/labels';
import { createClient } from '@/lib/supabase/client';
import { getSandboxRun } from '@/lib/supabase/agent';
import { keptConflictsOf } from '@/lib/workflow/routine-conflicts';
import type { AgentStep } from '@/types/agent';
import { ExecutionBadge } from './execution-badge';

const STATUS_ICON: Record<AgentStep['status'], string> = {
  running: 'progress_activity',
  succeeded: 'check_circle',
  failed: 'error',
  blocked: 'block',
  awaiting_decision: 'pending',
  cancelled: 'cancel',
  interrupted: 'report',
};

/** Plots and files a computation wrote to /out, from the owner-only bucket. */
function SandboxFiles({ runId }: { runId: string }) {
  const [files, setFiles] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const run = await getSandboxRun(runId).catch(() => null);
      const artifacts = (run?.artifacts ?? []) as { name: string; path?: string }[];
      const out: { name: string; url: string }[] = [];
      for (const a of artifacts) {
        if (!a.path) continue;
        const { data } = await createClient().storage.from('sandbox-artifacts').createSignedUrl(a.path, 600);
        if (data?.signedUrl) out.push({ name: a.name, url: data.signedUrl });
      }
      if (live) setFiles(out);
    })();
    return () => {
      live = false;
    };
  }, [runId]);
  if (!files.length) return null;
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {files.map((f) =>
        f.name.endsWith('.png') ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL; next/image cannot optimise it
          <img key={f.name} src={f.url} alt={tr('tl.output', { name: f.name })} className="w-full rounded-lg bg-white" />
        ) : (
          <a key={f.name} href={f.url} className="text-label text-[var(--pm-primary)] underline">
            {f.name}
          </a>
        )
      )}
    </div>
  );
}

export function StepTimeline({
  steps,
  stageName,
  onApplyAnyway,
}: {
  steps: AgentStep[];
  stageName?: (id: string) => string;
  /** L-93: a step that kept the record under the routine-decision policy offers the usual question back. */
  onApplyAnyway?: (step: AgentStep) => void;
}) {
  if (!steps.length) return null;
  // Repeated identical steps are one row with a count (2 Oct, screenshot 7).
  const rows = collapseSteps(steps);
  return (
    <ol aria-label={tr('tl.label')} className="space-y-2">
      {rows.map(({ step: s, repeats }) => (
        <li key={s.id} data-step-status={s.status} data-repeats={repeats > 1 ? repeats : undefined} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
          <details open={s.status === 'running' || s.idx === steps.at(-1)?.idx}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
              <span
                aria-hidden
                className={`material-symbols-outlined text-[1.1rem] ${s.status === 'running' ? 'animate-spin' : ''} ${
                  s.status === 'succeeded' ? 'text-[var(--pm-secondary)]' : s.status === 'blocked' || s.status === 'failed' ? 'text-[var(--pm-tertiary)]' : 'text-[var(--on-surface-variant)]'
                }`}
              >
                {STATUS_ICON[s.status]}
              </span>
              <span className="text-label text-[var(--on-surface-variant)]">{s.idx + 1}.</span>
              <span className="text-title text-[var(--on-surface)]">
                {stepLabel(s)}
                {/* A repair says which stage it repaired (13 Oct). */}
                {stageName && typeof s.params?.stage_id === 'string' && s.params.stage_id !== s.stage_id ? ` — ${stageName(s.params.stage_id)}` : ''}
              </span>
              {repeats > 1 && <span className="text-label text-[var(--on-surface-variant)]">×{repeats}</span>}
              <ExecutionBadge label={s.execution_label} />
              <span className="ml-auto text-label text-[var(--on-surface-variant)]">{tr(`stepStatus.${s.status}`)}</span>
            </summary>
            <div className="mt-2 space-y-2 pl-7">
              {s.rationale && <p className="text-label text-[var(--on-surface-variant)]">{tr('tl.why')}{s.rationale}</p>}
              {s.output && <MarkdownOutput content={s.output} />}
              {s.changes?.sandbox_run_id && <SandboxFiles runId={s.changes.sandbox_run_id} />}
              {onApplyAnyway && keptConflictsOf(s.params) && (
                <button
                  onClick={() => onApplyAnyway(s)}
                  className="rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label text-[var(--on-surface)]"
                >
                  {tr('tl.applyAnyway')}
                </button>
              )}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
