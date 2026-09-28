/**
 * Waiting for section jobs from the Go loop (B2b).
 *
 * Drafting runs through the job queue: the browser's drain hook nudges the
 * server, cron finishes whatever the browser does not. A Go step that
 * enqueued sections therefore has nothing to "await" but the queue itself.
 * This polls the jobs and the artifact, drains when no other tab is (the
 * same Web Lock the renderer's hook holds), and classifies the outcome — all
 * of which is pure except the polling.
 */

import { drainLockName, drainOnce } from './client-drain';
import { jobBySection, pendingJobs } from './sections';
import { isStoppedJob, listProjectJobs, type ProjectJob } from '@/lib/supabase/jobs';
import { getArtifact } from '@/lib/supabase/versions';
import type { OutlineSection } from '@/types';

export type WaitOutcome = 'done' | 'failed' | 'paused' | 'timeout';

export interface WaitResult {
  outcome: WaitOutcome;
  /** Targeted sections now complete. */
  written: string[];
  /** Targeted sections whose latest job stopped for good. */
  failed: { sectionId: string; title: string; message: string }[];
  /** Targeted sections still queued or running. */
  pending: string[];
  complete: number;
  total: number;
}

/** Where the targeted sections stand. Pure. */
export function classifyWait(
  outline: readonly OutlineSection[],
  jobs: readonly ProjectJob[],
  sectionIds: readonly string[]
): Omit<WaitResult, 'outcome'> & { settled: boolean } {
  const latest = jobBySection(jobs);
  const pendingIds = new Set(pendingJobs(jobs).map((j) => j.payload?.section_id as string));
  const written: string[] = [];
  const failed: WaitResult['failed'] = [];
  const pending: string[] = [];
  for (const id of sectionIds) {
    const section = outline.find((s) => s.id === id);
    const job = latest.get(id) ?? null;
    if (pendingIds.has(id)) pending.push(id);
    else if (section?.status === 'complete') written.push(id);
    else if (isStoppedJob(job) || section?.status === 'error') {
      failed.push({
        sectionId: id,
        title: section?.title ?? id,
        message: section?.error ?? job?.error_message ?? 'The section could not be written.',
      });
    } else pending.push(id);
  }
  return {
    written,
    failed,
    pending,
    complete: outline.filter((s) => s.status === 'complete').length,
    total: outline.length,
    settled: pending.length === 0,
  };
}

export const DEFAULT_WAIT_MS = 10 * 60_000;
const POLL_MS = 3_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** Drain once if no other tab is draining this project; never waits for the lock. */
async function nudge(projectId: string): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request(drainLockName(projectId), { ifAvailable: true }, async (lock) => {
        if (lock) await drainOnce(projectId);
      });
    } else {
      await drainOnce(projectId);
    }
  } catch {
    // A failed nudge is not an error: cron drains regardless.
  }
}

export async function awaitSectionJobs(args: {
  projectId: string;
  artifactId: string;
  sectionIds: readonly string[];
  signal: AbortSignal;
  timeoutMs?: number;
  onProgress?: (state: Omit<WaitResult, 'outcome'>) => void;
}): Promise<WaitResult> {
  const { projectId, artifactId, sectionIds, signal, onProgress } = args;
  const timeoutMs = args.timeoutMs ?? DEFAULT_WAIT_MS;
  const started = Date.now();
  let last: Omit<WaitResult, 'outcome'> & { settled: boolean } = {
    written: [], failed: [], pending: [...sectionIds], complete: 0, total: 0, settled: false,
  };
  for (;;) {
    if (signal.aborted) return { ...last, outcome: 'paused' };
    await nudge(projectId);
    const [artifact, jobs] = await Promise.all([getArtifact(artifactId), listProjectJobs(projectId)]);
    last = classifyWait(artifact?.long_form?.outline ?? [], jobs.filter((j) => j.payload?.artifact_id === artifactId), sectionIds);
    onProgress?.(last);
    if (last.settled) return { ...last, outcome: last.failed.length ? 'failed' : 'done' };
    if (Date.now() - started > timeoutMs) return { ...last, outcome: 'timeout' };
    await sleep(POLL_MS, signal);
  }
}
