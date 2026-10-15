import { describe, expect, it } from 'vitest';

import { collapseSteps, deriveExecutionLabel, readablePerformed } from './labels';

const row = (action_key: string, status = 'succeeded', output = '', execution_label: string | null = null) =>
  ({ action_key, status, output, execution_label }) as Parameters<typeof collapseSteps>[0][number];

describe('collapseSteps: a repeated step is one row with a count (2 Oct, screenshot 7)', () => {
  it('folds consecutive identical steps and keeps distinct ones apart', () => {
    const rows = collapseSteps([
      row('advance_stage'),
      row('mark_blocked', 'blocked', 'Could not continue: no draft.'),
      row('mark_blocked', 'blocked', 'Could not continue: no draft.'),
      row('mark_blocked', 'blocked', 'Could not continue: no draft.'),
      row('mark_blocked', 'blocked', 'Could not continue: something else.'),
    ]);
    expect(rows.map((r) => [r.step.action_key, r.repeats])).toEqual([
      ['advance_stage', 1],
      ['mark_blocked', 3],
      ['mark_blocked', 1],
    ]);
  });

  it('a row carries the latest of its steps, so the last row is still the last step', () => {
    const last = { ...row('evaluate_stage'), id: 'last' } as never;
    const rows = collapseSteps([row('evaluate_stage'), last]);
    expect(rows).toHaveLength(1);
    expect((rows[0].step as { id?: string }).id).toBe('last');
    expect(rows[0].repeats).toBe(2);
  });
});

describe('a repair has a label (Sean, 10 Oct, email 7.5)', () => {
  it('is a draft written, nothing run', () => {
    expect(deriveExecutionLabel('recheck_stage', { blocked: false })).toBe('designed');
  });
});

describe('what an objective check says was done (Sean, 14 Oct)', () => {
  it('reads an older record in the user\'s words', () => {
    expect(readablePerformed('recheck_stage (designed)')).toBe('Repair a reopened stage (draft written)');
    expect(readablePerformed('run_computation (code_executed)')).toBe('Run a computation (code executed)');
    expect(readablePerformed('Repair a reopened stage (draft written)')).toBe('Repair a reopened stage (draft written)');
  });
});
