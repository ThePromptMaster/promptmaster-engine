import { describe, expect, it } from 'vitest';

import { runAccount } from './account';

const run = (status: string, stop_reason: string | null = null) => ({ status, stop_reason }) as never;
const step = (action_key: string, extra: Record<string, unknown> = {}) => ({ action_key, status: 'succeeded', stage_id: 'experiment', params: {}, changes: {}, output: '', execution_label: null, ...extra }) as never;
const label = (id: string) => ({ experiment: 'Experiment', analysis: 'Analysis', method: 'Method' })[id] ?? id;

describe('the run account (Q3c; Sean, 9 Oct: "a short account of what it did, what it is doing next, or exactly why it paused")', () => {
  const steps = [
    step('run_computation', { execution_label: 'code_executed' }),
    step('run_computation', { execution_label: 'code_executed' }),
    step('derive'),
    step('revise_stage', { stage_id: 'analysis' }),
    step('return_to_stage', { stage_id: 'analysis', params: { stage_id: 'experiment' } }),
    step('advance_stage', { params: { set_aside_question: 'Should damping be included?' } }),
    step('run_computation', { status: 'blocked', changes: { set_aside: 'Row 4: the code sandbox is not available' } }),
  ];

  it('says what was done, told apart by what actually ran', () => {
    expect(runAccount(run('running'), steps, label)?.did).toBe(
      'Ran 2 computations in the sandbox; worked out 1 result by reasoning (not executed); wrote or revised Analysis; went back 1 time for further work (Experiment).'
    );
  });

  it('a window used up is a resource pause, not a problem', () => {
    const a = runAccount(run('budget_exhausted'), steps, label)!;
    expect(a.kind).toBe('window');
    expect(a.now).toContain('a resource limit, not a problem');
  });

  it('a blocker, a decision and completion each say what they are', () => {
    expect(runAccount(run('blocked', 'The code sandbox is not available. Try later.'), steps, label)!.now).toBe("Can't continue: The code sandbox is not available.");
    expect(runAccount(run('awaiting_decision', 'Do you approve the analysis plan?'), steps, label)!.kind).toBe('decision');
    expect(runAccount(run('completed', 'Objective met: "T(30°) = 2.0410 s".'), steps, label)!.now).toBe('Finished: the objective is verified as met.');
  });

  it('lists what it set aside rather than stopped for', () => {
    expect(runAccount(run('running'), steps, label)!.setAside).toEqual([
      'Question kept for you: Should damping be included?',
      'Could not be done here: Row 4: the code sandbox is not available',
    ]);
  });
});
