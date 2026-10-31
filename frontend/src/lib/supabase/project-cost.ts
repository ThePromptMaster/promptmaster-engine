import { createClient } from './client';
import { totalOf, type Spent } from '@/lib/observability/spent';

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
