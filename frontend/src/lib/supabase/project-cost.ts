import { createClient } from './client';
import { totalOf, type Spent } from '@/lib/observability/spent';
import { requestIdPrefix } from '@/lib/jobs/log';

/** Rows read for a project's total; a project past this is summed over its latest calls and says so. */
export const PROJECT_COST_ROWS = 10_000;

/**
 * What the model calls made for a project have cost (31 Oct, client: "I
 * couldn't tell whether chat messages or actions cost anything"). Read from
 * `model_usage` under the user's own select policy; a null price stays
 * unknown and is counted, never added as zero (FR-18). Null when it cannot
 * be read.
 */
export async function projectSpent(projectId: string): Promise<(Spent & { capped: boolean }) | null> {
  try {
    const { data, error } = await createClient()
      .from('model_usage')
      .select('cost_usd')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(PROJECT_COST_ROWS);
    if (error || !data) return null;
    const rows = data as { cost_usd: string | number | null }[];
    const spent = totalOf(rows.map((r) => ({ costUsd: r.cost_usd === null ? null : Number(r.cost_usd) })));
    return { ...spent, capped: rows.length >= PROJECT_COST_ROWS };
  } catch {
    return null;
  }
}

/** The drain's usage rows that belong to these jobs, summed (pure). */
export function spentOnJobs(rows: readonly { cost_usd: string | number | null; request_id: string | null }[], jobIds: readonly string[]): Spent {
  const prefixes = jobIds.map(requestIdPrefix);
  const mine = rows.filter((r) => prefixes.some((p) => (r.request_id ?? '').startsWith(p)));
  return totalOf(mine.map((r) => ({ costUsd: r.cost_usd === null ? null : Number(r.cost_usd) })));
}

/**
 * What the background drain spent on these jobs (2 Nov, production: Go's run
 * said $1.47 while drafting twelve chapters had cost $1.26 more). The drain
 * writes its usage rows itself, outside the browser that tallies a step's
 * calls, so they are read back by each job's request-id prefix. Null when
 * they cannot be read; best-effort, like every cost line.
 */
export async function jobsSpent(projectId: string, jobIds: readonly string[], since: string | null): Promise<Spent | null> {
  if (!jobIds.length) return null;
  try {
    let query = createClient()
      .from('model_usage')
      .select('cost_usd, request_id')
      .eq('project_id', projectId)
      .eq('source', 'drain');
    if (since) query = query.gte('created_at', since);
    const { data, error } = await query.limit(PROJECT_COST_ROWS);
    if (error || !data) return null;
    return spentOnJobs(data as { cost_usd: string | number | null; request_id: string | null }[], jobIds);
  } catch {
    return null;
  }
}
