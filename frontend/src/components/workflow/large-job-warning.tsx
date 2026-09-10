'use client';

/**
 * FR-18: "Large jobs can trigger a warning where practical."
 *
 * Drafting a book is the one action in this product that commits to spending
 * real money without asking again. Pressing "Start drafting" on a
 * thirty-section outline queues sixty provider calls that will keep running
 * after the tab is closed, and until now the only feedback was that a progress
 * bar appeared.
 *
 * Three decisions worth stating.
 *
 * **The estimate costs nothing to produce.** `/api/estimate-job` makes no LLM
 * call — it is arithmetic over the backend's own limits plus the live provider
 * price. A confirmation that has to wait on a model round-trip is one people
 * learn to click through blind.
 *
 * **The warning is not shown for small runs.** A dialog in front of every draft
 * is a dialog nobody reads, and training people to dismiss a cost warning is
 * worse than never showing one. The threshold lives on the server, next to the
 * copy that explains it, so the two cannot drift apart.
 *
 * **A failed estimate does not block the work.** If the estimate call fails, the
 * draft proceeds. The alternative — refusing to start because a telemetry
 * endpoint was unreachable — would make a cost *advisory* into a hard
 * dependency of the core feature, which is a much worse failure than a missing
 * warning.
 */

import { useEffect, useState } from 'react';

import { api, type JobEstimate } from '@/lib/api/client';
import { formatTokens, formatUsd } from '@/lib/observability/usage';

interface Props {
  /** Sections that will actually be drafted — completed ones are skipped. */
  sectionCount: number;
  model: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LargeJobWarning({ sectionCount, model, onConfirm, onCancel }: Props) {
  const [estimate, setEstimate] = useState<JobEstimate | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .estimateJob({ section_count: sectionCount, model })
      .then((result) => {
        if (!cancelled) setEstimate(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sectionCount, model]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="large-job-title"
      className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-[var(--pm-tertiary)]"
        >
          savings
        </span>
        <div className="min-w-0 flex-1">
          <p id="large-job-title" className="text-title text-[var(--on-surface)]">
            This is a large drafting run
          </p>

          <p className="mt-1 max-w-[68ch] text-body text-[var(--on-surface-variant)]">
            {estimate?.warning ??
              (failed
                ? `This will draft ${sectionCount} sections. The cost estimate could not be loaded, but drafting runs in the background and can be paused at any time.`
                : `Working out what ${sectionCount} sections will involve…`)}
          </p>

          {estimate && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
              <Figure label="Sections" value={formatTokens(estimate.section_count)} />
              <Figure label="Model calls" value={formatTokens(estimate.llm_calls)} />
              <Figure
                label="Estimated cost"
                value={formatUsd(estimate.estimated_cost_usd)}
                // Never "$0.00" when the price is simply unknown — see
                // lib/observability/usage.ts and the migration.
                note={estimate.estimated_cost_usd === null ? 'price unavailable' : 'approximate'}
              />
            </dl>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-full bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          Start drafting
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-[var(--surface-container-lowest)] px-4 py-2 text-label text-[var(--on-surface)] transition-opacity hover:opacity-80"
        >
          Not yet
        </button>
      </div>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-label text-[var(--on-surface-variant)]">{label}</dt>
      <dd className="text-title text-[var(--on-surface)]">
        {value}
        {note && (
          <span className="ml-1 text-label font-normal text-[var(--on-surface-variant)]">
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * Whether to interrupt at all.
 *
 * Mirrors `LARGE_JOB_SECTION_THRESHOLD` in `promptmaster/limits.py`. Duplicated
 * as a constant rather than fetched, because this decides whether to *ask* the
 * server — asking the server whether to ask the server is a round-trip in front
 * of every small draft, which is exactly the latency this is trying to avoid.
 * The server remains the authority on the warning's wording and figures.
 */
export const LARGE_JOB_SECTIONS = 12;

export function isLargeJob(sectionCount: number): boolean {
  return sectionCount >= LARGE_JOB_SECTIONS;
}
