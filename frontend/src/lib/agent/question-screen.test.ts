import { describe, expect, it } from 'vitest';

import { findingAsQuestion, planFromScreen, shouldScreen, type QuestionScreen } from './question-screen';

const screen = (over: Partial<QuestionScreen>): QuestionScreen => ({ verdict: 'business_decision', reason: 'Why.', instruction: '', target_stage: '', action: '', requirement_quote: '', ...over });
const base = {
  question: 'Should I shorten it to about 1,200 words?',
  template: { stages: [{ id: 'm', label: 'Manuscript' }, { id: 'f', label: 'Final' }] } as never,
  stage: { transitions: { allow_return_to: ['m'] } } as never,
  allowed: ['revise_stage', 'declare_objective_complete'],
  returnsLeft: 3,
};

describe('which questions are read at all (8 Nov)', () => {
  const on = { policy: 'autonomous' as const, routine: 'handle', question: 'Shorten it?', recordedHere: 0 };
  it('only when routine decisions are handed over', () => {
    expect(shouldScreen(on)).toBe(true);
    expect(shouldScreen({ ...on, routine: 'ask' })).toBe(false);
    expect(shouldScreen({ ...on, policy: 'checkpoint' })).toBe(false);
  });
  it('never a question about the objective or the user’s own decision, or one for an expert', () => {
    expect(shouldScreen({ ...on, question: 'Should the scope change?' })).toBe(false);
    expect(shouldScreen({ ...on, expert: true })).toBe(false);
  });
  it('stops recording after two on a stage, so a wrong screen cannot loop', () => {
    expect(shouldScreen({ ...on, recordedHere: 2 })).toBe(false);
  });
});

describe('what happens to a question once read (8 Nov)', () => {
  it('a real-world action is recorded, not asked', () => {
    expect(planFromScreen(screen({ verdict: 'real_world_action', action: 'Confirm cover for the hour.' }), base)).toEqual({ kind: 'record', action: 'Confirm cover for the hour.', reason: 'Why.' });
  });

  it('a routine repair on this stage becomes a revision', () => {
    const plan = planFromScreen(screen({ verdict: 'routine_repair', instruction: 'Shorten to about 1,200 words.' }), base);
    expect(plan.kind).toBe('repair');
    if (plan.kind === 'repair') {
      expect(plan.move.action_key).toBe('revise_stage');
      expect(plan.move.params).toEqual({ instruction: 'Shorten to about 1,200 words.' });
      expect(plan.move.rationale).toContain('Instead of asking');
    }
  });

  it('a correction that belongs on an earlier stage goes back there', () => {
    const plan = planFromScreen(screen({ verdict: 'routine_repair', instruction: 'Cite Section 5.', target_stage: 'Manuscript' }), base);
    expect(plan.kind === 'repair' && plan.move.action_key).toBe('return_to_stage');
    expect(plan.kind === 'repair' && plan.move.params).toMatchObject({ stage_id: 'm', work: 'Cite Section 5.' });
  });

  it('is asked when the move is not open: no way back, or no revising here', () => {
    const noWay = { ...base, stage: { transitions: {} } as never };
    expect(planFromScreen(screen({ verdict: 'routine_repair', instruction: 'x', target_stage: 'Manuscript' }), noWay)).toEqual({ kind: 'ask' });
    expect(planFromScreen(screen({ verdict: 'routine_repair', instruction: 'x', target_stage: 'Manuscript' }), { ...base, returnsLeft: 0 })).toEqual({ kind: 'ask' });
    expect(planFromScreen(screen({ verdict: 'routine_repair', instruction: 'x' }), { ...base, allowed: [] })).toEqual({ kind: 'ask' });
  });

  it('an approval already given is not asked again after routine repairs', () => {
    const plan = planFromScreen(screen({ verdict: 'reserved_approval' }), { ...base, approvalStands: true, allowed: ['declare_objective_complete'] });
    expect(plan.kind === 'repair' && plan.move.action_key).toBe('declare_objective_complete');
    expect(planFromScreen(screen({ verdict: 'reserved_approval' }), { ...base, approvalStands: false, allowed: ['declare_objective_complete'] })).toEqual({ kind: 'ask' });
  });

  it('everything else is asked', () => {
    for (const verdict of ['business_decision', 'reserved_approval', 'missing_input'] as const) {
      expect(planFromScreen(screen({ verdict }), base)).toEqual({ kind: 'ask' });
    }
    expect(planFromScreen(screen({ verdict: 'routine_repair', instruction: '  ' }), base)).toEqual({ kind: 'ask' });
  });
});

describe('a major finding read as the question it would be (8 Nov, production)', () => {
  it('asks whether to make the change', () => {
    expect(findingAsQuestion({ finding: 'Length is not verified.', suggested_change: 'Use one staffing table.' })).toBe('A check on this project found: "Length is not verified." Suggested change: "Use one staffing table." Should this change be made?');
    expect(findingAsQuestion({ finding: 'A problem.' })).toBe('A check on this project found: "A problem." Should this change be made?');
  });
});


describe('routine work this run can no longer do on the stage (9 Nov, production)', () => {
  it('is judged as it stands and noted, not asked', () => {
    const plan = planFromScreen(screen({ verdict: 'routine_repair', instruction: 'Trim to 4,000 words.' }), { ...base, allowed: ['declare_objective_complete'] });
    expect(plan).toMatchObject({ kind: 'repair', move: { action_key: 'declare_objective_complete', params: { set_aside_question: base.question } } });
  });

  it('with nothing left to do either, it is still asked', () => {
    expect(planFromScreen(screen({ verdict: 'routine_repair', instruction: 'Trim.' }), { ...base, allowed: [] })).toEqual({ kind: 'ask' });
  });
});
