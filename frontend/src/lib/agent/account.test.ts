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

  it('a kept question the user has since answered is no longer kept (6 Nov, production: "do whatever is best")', () => {
    const asked = 'Which sign should the note use for the Regge action?';
    const withAnswer = [
      step('advance_stage', { params: { set_aside_question: asked } }),
      step('request_user_decision', { decision_question: asked }),
      step('user_answer', { output: 'Do whatever is best' }),
    ];
    expect(runAccount(run('completed'), withAnswer, label)?.setAside).toEqual([]);
    // Asked and not answered, or a different question answered: still kept.
    expect(runAccount(run('completed'), withAnswer.slice(0, 2), label)?.setAside).toHaveLength(1);
    const other = [withAnswer[0], step('request_user_decision', { decision_question: 'Should damping be included in the model?' }), withAnswer[2]];
    expect(runAccount(run('completed'), other, label)?.setAside).toHaveLength(1);
  });

  it('a question set aside at several steps is listed once (12 Nov, production)', () => {
    const asked = 'Should I make one more edit to the final proposal to delete the duplicate line?';
    const thrice = [1, 2, 3].map(() => step('recheck_stage', { params: { set_aside_question: asked } }));
    const another = step('advance_stage', { params: { set_aside_question: 'Numbered headings or not?' } });
    expect(runAccount(run('awaiting_decision'), [...thrice, another], label)?.setAside).toEqual([
      `Question kept for you: ${asked}`,
      'Question kept for you: Numbered headings or not?',
    ]);
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

describe('11 Oct, survey brief: "Your decision is needed" names the decision', () => {
  it('a stop with a request says its choices, not the stop sentence', () => {
    const r = {
      status: 'awaiting_decision', stop_reason: 'The objective is not met yet. Not met: Output: at most 200 words — measured 214 words.',
      needs: { kind: 'objective_check', stageId: 'output', finding: 'unmet', items: ['Output: at most 200 words — measured 214 words'] },
    } as never;
    const now = runAccount(r, [], (id) => (id === 'output' ? 'Output' : id))!.now;
    expect(now).toMatch(/^Your decision is needed: “Have Go fix Output and check again” or “I will fix it myself”\./);
    expect(now).toContain('not met: Output: at most 200 words — measured 214 words');
  });

  it('an approval given by choosing an option names that press, not a button its card does not have (12 Nov)', () => {
    const r = {
      status: 'awaiting_decision', stop_reason: 'Needs your approval: "I choose the recovery option.".',
      needs: { kind: 'tick_criterion', stageId: 'options', onStage: 'options', criterionId: 'options.approved', label: 'I choose the recovery option.', authority: 'reserved' },
    } as never;
    const stage = (id: string) => (id === 'options' ? 'Options' : id);
    expect(runAccount(r, [], stage)!.now).toMatch(/^Your decision is needed: “Approve and resume”\./);
    expect(runAccount(r, [], stage, 'en', undefined, true)!.now).toMatch(/^Your decision is needed: “Choose an option”\. Needs your approval: "I choose the recovery option\."/);
  });
});

it('a finish names what was deferred and why it does not block', () => {
  const r = { status: 'completed', stop_reason: 'Objective met. Deferred, not blocking (none says a requirement is unmet): Summary: "Tighten the closing line" — deferred because style only.' } as never;
  expect(runAccount(r, [], (id) => id)!.now).toBe('Finished: the objective is verified as met. Deferred, not blocking (none says a requirement is unmet): Summary: "Tighten the closing line" — deferred because style only.');
});
