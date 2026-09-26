'use client';

import { useEffect, useState } from 'react';

import { MarkdownOutput } from '@/components/shared/markdown-output';
import { actionLabel } from '@/lib/agent/actions';
import { createClient } from '@/lib/supabase/client';
import { getSandboxRun } from '@/lib/supabase/agent';
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
          <img key={f.name} src={f.url} alt={`Output: ${f.name}`} className="w-full rounded-lg bg-white" />
        ) : (
          <a key={f.name} href={f.url} className="text-label text-[var(--pm-primary)] underline">
            {f.name}
          </a>
        )
      )}
    </div>
  );
}

export function StepTimeline({ steps }: { steps: AgentStep[] }) {
  if (!steps.length) return null;
  return (
    <ol aria-label="Go mode steps" className="space-y-2">
      {steps.map((s) => (
        <li key={s.id} data-step-status={s.status} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
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
              <span className="text-title text-[var(--on-surface)]">{actionLabel(s.action_key)}</span>
              <ExecutionBadge label={s.execution_label} />
              <span className="ml-auto text-label text-[var(--on-surface-variant)]">{s.status.replace(/_/g, ' ')}</span>
            </summary>
            <div className="mt-2 space-y-2 pl-7">
              {s.rationale && <p className="text-label text-[var(--on-surface-variant)]">Why: {s.rationale}</p>}
              {s.output && <MarkdownOutput content={s.output} />}
              {s.changes?.sandbox_run_id && <SandboxFiles runId={s.changes.sandbox_run_id} />}
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}
