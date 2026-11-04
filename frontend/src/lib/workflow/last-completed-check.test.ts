import { describe, expect, it } from 'vitest';

import { lastCompletedCheck } from './evaluation-failure';

const versions = [1, 2, 3, 4].map((n) => ({ id: `v${n}`, version_number: n }));
const ok = (id: string) => ({ id, alignment_explanation: 'fine', drift_explanation: 'fine', clarity_explanation: 'fine', findings: [] as unknown[] });
const failed = (id: string) => ({ ...ok(id), failed: true });

describe('the last completed check of an earlier version (4 Nov)', () => {
  it('is nothing when the version shown has a check that ran', () => {
    expect(lastCompletedCheck(versions, { v2: ok('e2'), v4: ok('e4') }, 'v4')).toBeNull();
  });

  it('is the latest earlier check that ran, when this one could not run or never did', () => {
    const evals = { v1: ok('e1'), v2: ok('e2'), v3: failed('e3'), v4: failed('e4') };
    expect(lastCompletedCheck(versions, evals, 'v4')).toEqual({ evaluation: evals.v2, version: 2 });
    expect(lastCompletedCheck(versions, { v1: ok('e1') }, 'v4')).toEqual({ evaluation: ok('e1'), version: 1 });
  });

  it('never offers a later version\'s check for an earlier one', () => {
    expect(lastCompletedCheck(versions, { v4: ok('e4') }, 'v2')).toBeNull();
  });
});
