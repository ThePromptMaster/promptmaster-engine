import { describe, expect, it } from 'vitest';

import { percentile, rollUpOperations, rollUpProjects, type UsageDetailRow } from './usage-rollups';

const row = (over: Partial<UsageDetailRow>): UsageDetailRow => ({
  project_id: 'p1', route: '/api/generate-stage-artifact', operation: null, attempt: 'first', elapsed_ms: 1000, cost_usd: '0.01', ...over,
});

describe('where the spend went (E1)', () => {
  it('groups by Go move or route, with time percentiles and the share that was rework', () => {
    const ops = rollUpOperations([
      row({ operation: 'go:revise_stage', elapsed_ms: 2000, cost_usd: 0.05 }),
      row({ operation: 'go:revise_stage', elapsed_ms: 4000, cost_usd: 0.05, attempt: 'repair' }),
      row({}),
      row({ cost_usd: null, elapsed_ms: null }),
    ]);
    expect(ops[0]).toMatchObject({ operation: 'go:revise_stage', calls: 2, p50Ms: 2000, p95Ms: 4000, reworkShare: 0.5 });
    expect(ops[0].costUsd).toBeCloseTo(0.1);
    expect(ops[1]).toMatchObject({ operation: '/api/generate-stage-artifact', calls: 2, unpricedCalls: 1, p50Ms: 1000 });
  });

  it('an unpriced group costs null, never zero', () => {
    expect(rollUpOperations([row({ cost_usd: null })])[0].costUsd).toBeNull();
  });

  it('totals each project: cost, model time, Go calls and rework', () => {
    const [p] = rollUpProjects(
      [row({ operation: 'go:draft_stage' }), row({ attempt: 'retry', elapsed_ms: 500 }), row({ project_id: null })],
      new Map([['p1', 'Margin memo']])
    );
    expect(p).toMatchObject({ projectId: 'p1', title: 'Margin memo', calls: 2, modelMs: 1500, goCalls: 1, reworkCalls: 1 });
  });

  it('percentiles of nothing are null', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
});
