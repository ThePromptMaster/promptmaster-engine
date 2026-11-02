import { describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ createClient: () => ({}) }));

import { requestIdPrefix, stepRequestId } from '@/lib/jobs/log';
import { spentOnJobs } from './project-cost';
import { addStepCost, takeStepCost } from './model-usage';

/**
 * 2 Nov, production: Go drafted twelve chapters through background jobs; the
 * drain's $1.26 reached the project's total but not the step that queued
 * them, and the run said $1.47 when it had spent about $2.73.
 */
describe("what a Go step's background sections cost", () => {
  const job = 'c0650165-ff73-4b8e-9a1d-2f0e3c4d5e6f';

  it('finds the drain rows by the request id every call of the job sends', () => {
    expect(stepRequestId(job, '/api/generate-section-prose').startsWith(requestIdPrefix(job))).toBe(true);
    expect(requestIdPrefix(job)).toBe('jobc0650165ff73');
  });

  it("sums only these jobs' rows, and keeps an unknown price unknown", () => {
    const rows = [
      { cost_usd: '0.0669', request_id: `${requestIdPrefix(job)}nprosemqkz7g` },
      { cost_usd: '0.0250', request_id: `${requestIdPrefix(job)}recordjz73nk` },
      { cost_usd: null, request_id: `${requestIdPrefix(job)}recordaaaaaa` },
      { cost_usd: '9.99', request_id: 'job5f90007a9d9dnprosedr99sh' },
    ];
    const spent = spentOnJobs(rows, [job]);
    expect(spent.calls).toBe(3);
    expect(spent.unpriced).toBe(1);
    expect(spent.cost).toBeCloseTo(0.0919, 6);
    expect(spentOnJobs(rows, [])).toMatchObject({ calls: 0, cost: null });
  });

  it('is added to the step before it is taken, and an unpriced total stays unknown', () => {
    addStepCost('step-1', { cost: 1.26, calls: 24 });
    addStepCost('step-1', { cost: 0.5, calls: 1 });
    expect(takeStepCost('step-1')).toBeCloseTo(1.76, 6);
    expect(takeStepCost('step-1')).toBeNull();
    addStepCost('step-2', { cost: null, calls: 3 });
    expect(takeStepCost('step-2')).toBeNull();
  });
});
