/**
 * FR-19: the drain logged nothing at all.
 *
 * Zero `console.*` calls existed anywhere under `src/app/api/` or
 * `src/lib/jobs/`. The `DrainReport` — how many jobs were reaped, claimed,
 * completed, failed — went into the HTTP response body, and the only caller in
 * production is Vercel Cron, which discards it. So the component that spends
 * the most money, runs unattended, and is the hardest to reproduce was also the
 * one component that left no trace.
 *
 * This is the smallest thing that fixes that: one JSON object per line on
 * stdout, which is what the platform's log drain indexes.
 *
 * **The correlation id is the point.** Each job step generates one and passes
 * it to FastAPI as `X-Request-Id`, which the backend adopts rather than
 * replacing. One id therefore appears in this log, in the API's log, and on the
 * `model_usage` row for the call — so "why did this section fail" is a search
 * for a string rather than a comparison of timestamps across two services.
 *
 * **Never a secret.** Job payloads carry the user's objective, constraints and
 * session facts, which is their work product. Nothing here logs a payload: only
 * ids, counts, codes and durations.
 */

type Level = 'info' | 'warn' | 'error';

export interface DrainLogFields {
  event: string;
  jobId?: string;
  projectId?: string | null;
  userId?: string;
  requestId?: string;
  sectionIndex?: number;
  step?: string;
  code?: string;
  durationMs?: number;
  attempts?: number;
  [key: string]: unknown;
}

/**
 * Quiet under test. The suite runs the drain hundreds of times and a JSON line
 * per step would bury the actual assertions — the logging is exercised
 * deliberately by its own test rather than as a side effect of every other one.
 */
function silent(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';
}

export function drainLog(level: Level, fields: DrainLogFields): void {
  if (silent()) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level: level.toUpperCase(),
    logger: 'jobs.drain',
    ...fields,
  });

  // `console.error` for warn and error so the platform routes them to the
  // error stream and they can be alerted on separately from the chatter.
  if (level === 'info') console.log(line);
  else console.error(line);
}

/**
 * A correlation id for one job step.
 *
 * Prefixed with the job id so a line is identifiable even when read on its own,
 * and suffixed with randomness so a retried step is distinguishable from the
 * attempt before it — otherwise two attempts at the same section collapse into
 * one apparent request that somehow spent twice.
 */
export function stepRequestId(jobId: string, step: string): string {
  const short = jobId.replace(/-/g, '').slice(0, 12);
  const nonce = Math.random().toString(36).slice(2, 8);
  return `job${short}${step.slice(0, 4)}${nonce}`;
}
