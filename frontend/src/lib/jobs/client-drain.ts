/**
 * One nudge of the job drain from the browser (B2a).
 *
 * Extracted from `hooks/use-job-drain.ts` so that something other than the
 * renderer's polling loop — Go mode waiting on the sections it enqueued — can
 * drain the same queue through the same endpoint, under the same Web Lock.
 * Cron remains the mechanism that guarantees the work finishes (FR-05); this
 * is latency only.
 */

import { createClient } from '@/lib/supabase/client';

/** One drainer per project per browser, across all its tabs. */
export function drainLockName(projectId: string): string {
  return `pm-drain-${projectId}`;
}

/** Drain once. True when the call claimed work; false when there was nothing, or no session. */
export async function drainOnce(projectId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return false;

  const res = await fetch('/api/jobs/drain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ project_id: projectId }),
  });
  if (!res.ok) return false;

  const report = (await res.json()) as { claimed?: number };
  return (report.claimed ?? 0) > 0;
}
