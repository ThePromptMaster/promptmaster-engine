/**
 * Where the model spend went, and how much of it was rework (E1; Sean, 5 Oct:
 * "measure model/tool costs, elapsed time, … retries, and repair work"). Pure.
 *
 * By operation — a Go move ("go:revise_stage") or, for anything else, the
 * route — and by project. A cost is null only when no call in the group had a
 * known price; unpriced calls are counted, never folded in as zero.
 */

export interface UsageDetailRow {
  project_id: string | null;
  route: string | null;
  operation: string | null;
  attempt: string | null;
  elapsed_ms: number | null;
  cost_usd: string | number | null;
}

export interface OperationRollup {
  operation: string;
  calls: number;
  costUsd: number | null;
  unpricedCalls: number;
  /** Median and 95th-percentile call time, in ms; null when no call recorded one. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** Share of calls that were retries or JSON repair passes. */
  reworkShare: number;
}

export interface ProjectRollup {
  projectId: string;
  title: string | null;
  calls: number;
  costUsd: number | null;
  unpricedCalls: number;
  /** Total model time, ms. */
  modelMs: number;
  /** Calls made by Go moves. */
  goCalls: number;
  reworkCalls: number;
}

function cost(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

const isRework = (r: UsageDetailRow) => r.attempt === 'retry' || r.attempt === 'repair';

export function rollUpOperations(rows: readonly UsageDetailRow[]): OperationRollup[] {
  const groups = new Map<string, UsageDetailRow[]>();
  for (const r of rows) {
    const key = r.operation || r.route || '(unknown)';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([operation, rs]) => {
      const priced = rs.map((r) => cost(r.cost_usd)).filter((c): c is number => c !== null);
      const times = rs.map((r) => r.elapsed_ms).filter((m): m is number => typeof m === 'number').sort((a, b) => a - b);
      return {
        operation,
        calls: rs.length,
        costUsd: priced.length ? priced.reduce((a, b) => a + b, 0) : null,
        unpricedCalls: rs.length - priced.length,
        p50Ms: percentile(times, 50),
        p95Ms: percentile(times, 95),
        reworkShare: rs.filter(isRework).length / rs.length,
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls);
}

export function rollUpProjects(rows: readonly UsageDetailRow[], titles: ReadonlyMap<string, string>): ProjectRollup[] {
  const groups = new Map<string, UsageDetailRow[]>();
  for (const r of rows) if (r.project_id) groups.set(r.project_id, [...(groups.get(r.project_id) ?? []), r]);
  return [...groups.entries()]
    .map(([projectId, rs]) => {
      const priced = rs.map((r) => cost(r.cost_usd)).filter((c): c is number => c !== null);
      return {
        projectId,
        title: titles.get(projectId) ?? null,
        calls: rs.length,
        costUsd: priced.length ? priced.reduce((a, b) => a + b, 0) : null,
        unpricedCalls: rs.length - priced.length,
        modelMs: rs.reduce((n, r) => n + (r.elapsed_ms ?? 0), 0),
        goCalls: rs.filter((r) => (r.operation ?? '').startsWith('go:')).length,
        reworkCalls: rs.filter(isRework).length,
      };
    })
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls);
}
