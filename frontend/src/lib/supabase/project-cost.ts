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
export async function projectSpent(projectId: string): Promise<(Spent & { capped: boolean; goSteps: number; goCalls: number; byKind: CostByKind }) | null> {
  try {
    const { data, error } = await createClient()
      .from('model_usage')
      .select('cost_usd, operation, agent_step_id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(PROJECT_COST_ROWS);
    if (error || !data) return null;
    const rows = data as { cost_usd: string | number | null; operation?: string | null; agent_step_id?: string | null }[];
    const spent = totalOf(rows.map((r) => ({ costUsd: r.cost_usd === null ? null : Number(r.cost_usd) })));
    return { ...spent, capped: rows.length >= PROJECT_COST_ROWS, ...goShare(rows), byKind: costByKind(rows) };
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

/**
 * Go's share of a project's calls, told apart from its steps (4 Nov, Sean: "a
 * way to distinguish workflow actions from model calls in the usage view"): the
 * steps Go took, and the model calls made for them or for choosing them.
 */
export function goShare(rows: readonly { operation?: string | null; agent_step_id?: string | null }[]): { goSteps: number; goCalls: number } {
  const steps = new Set<string>();
  let goCalls = 0;
  for (const r of rows) {
    if (!(r.operation ?? '').startsWith('go:')) continue;
    goCalls += 1;
    if (r.agent_step_id) steps.add(r.agent_step_id);
  }
  return { goSteps: steps.size, goCalls };
}

export type CostKind = 'first_draft' | 'revision' | 'review' | 'repair' | 'planning' | 'chat' | 'other';
export type CostByKind = Partial<Record<CostKind, number>>;

const KIND_OF: Readonly<Record<string, CostKind>> = {
  'go:draft_stage': 'first_draft', 'go:draft_sections': 'first_draft', 'go:continue_writing': 'first_draft', 'go:generate_outline': 'first_draft',
  'drain:first_draft': 'first_draft', 'drain:continue': 'first_draft', '/api/generate-stage-artifact': 'first_draft', '/api/generate-outline': 'first_draft',
  'go:revise_stage': 'revision', 'go:apply_findings': 'revision', 'go:revise_sections': 'revision', 'drain:revision': 'revision',
  '/api/apply-to-answer': 'revision', '/api/apply-recommendations': 'revision', '/api/save-as-new-version': 'revision', '/api/flow-trigger': 'revision',
  'go:evaluate_stage': 'review', 'go:declare_objective_complete': 'review', 'go:triage_findings': 'review', 'go:commit_delegated': 'review', 'go:advance_stage': 'review',
  '/api/evaluate-stage-artifact': 'review', '/api/check-conflicts': 'review', '/api/assess-change': 'review', '/api/extract-figures': 'review', '/api/revision-facts': 'review',
  '/api/agent/check-answer': 'review', '/api/agent/check-criterion': 'review', '/api/agent/assess-objective': 'review', '/api/agent/screen-question': 'review', '/api/agent/decision-options': 'review', '/api/agent/settles': 'review', '/api/agent/group-questions': 'planning',
  '/api/claim-support': 'review', '/api/dependent-claims': 'review', '/api/check-new-claims': 'review',
  'go:recheck_stage': 'repair', 'drain:repair': 'repair',
  'go:plan': 'planning', '/api/agent/next-action': 'planning', 'go:return_to_stage': 'planning', 'go:propose_next_round': 'planning',
  '/api/chat-message': 'chat', '/api/suggest-actions': 'chat', '/api/front-door': 'chat', '/api/guide-next-question': 'chat', '/api/generate-setup': 'chat', '/api/generate-workflow': 'chat',
};

/** What a project's priced calls went on (pure; a call with no price is not added). */
export function costByKind(rows: readonly { cost_usd: string | number | null; operation?: string | null }[]): CostByKind {
  const out: CostByKind = {};
  for (const r of rows) {
    if (r.cost_usd === null) continue;
    const kind = KIND_OF[r.operation ?? ''] ?? 'other';
    out[kind] = (out[kind] ?? 0) + Number(r.cost_usd);
  }
  return out;
}
