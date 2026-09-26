import { describe, expect, it } from 'vitest';

import { nextStageAction, type NextActionInput } from './next-action';

const base: NextActionInput = {
  finished: false,
  busy: false,
  dirty: false,
  draftable: true,
  hasContent: true,
  evaluable: true,
  evaluated: true,
  evaluationClean: true,
  applyableFixes: 0,
  canAdvance: true,
  isLast: false,
  nextLabel: 'Audience',
};

const kind = (overrides: Partial<NextActionInput>) => nextStageAction({ ...base, ...overrides }).kind;

describe('nextStageAction — one primary action per stage (PM-06)', () => {
  it('lets a panel-driven stage name its own step instead of "Continue anyway"', () => {
    // Drafting showed "Continue to Continuity anyway" beside a "Start drafting"
    // button; the outline showed "Continue to Approval" beside "Save and approve".
    const drafting = { draftable: false, hasContent: false, canAdvance: false };
    const step = { label: 'Start drafting', reason: 'Writes each section.' };
    expect(nextStageAction({ ...base, ...drafting, panelStep: step })).toMatchObject({
      kind: 'panel',
      label: 'Start drafting',
    });
    expect(kind({ ...drafting, panelStep: { ...step, busy: true } })).toBe('none');
    // Once the panel has nothing left to do, moving on is the step again.
    expect(kind({ ...drafting, canAdvance: true, panelStep: null })).toBe('continue');
    // Unsaved edits still come first.
    expect(kind({ ...drafting, dirty: true, panelStep: step })).toBe('save');
  });

  it('walks draft -> check -> fix -> continue, as a careful user would', () => {
    expect(kind({ hasContent: false, evaluated: false })).toBe('draft');
    expect(kind({ evaluated: false })).toBe('evaluate');
    expect(kind({ evaluationClean: false, applyableFixes: 2 })).toBe('apply_fixes');
    expect(kind({})).toBe('continue');
  });

  it('puts unsaved edits first: nothing else counts until they are saved', () => {
    expect(kind({ dirty: true, hasContent: false })).toBe('save');
    expect(kind({ dirty: true, evaluated: false })).toBe('save');
  });

  it('never suggests drafting a checkpoint stage (Outline approval)', () => {
    expect(kind({ draftable: false, hasContent: false, evaluable: false, evaluated: false })).toBe('continue');
  });

  it('suggests nothing while busy or once the project is finished', () => {
    expect(kind({ busy: true })).toBe('none');
    expect(kind({ finished: true })).toBe('none');
  });

  it('finishes the project on the last stage', () => {
    expect(nextStageAction({ ...base, isLast: true })).toMatchObject({ kind: 'finish', label: 'Finish project' });
  });

  it('names the next stage, and says "anyway" when required items are open', () => {
    expect(nextStageAction(base).label).toBe('Continue to Audience');
    expect(nextStageAction({ ...base, canAdvance: false }).label).toBe('Continue to Audience anyway');
  });

  it('says plainly when nothing needs another pass (PM-25)', () => {
    expect(nextStageAction(base).reason).toMatch(/nothing here needs another pass/i);
    expect(nextStageAction({ ...base, evaluated: false, evaluable: false }).reason).not.toMatch(/another pass/);
  });

  it('does not push fixes on a clean evaluation', () => {
    expect(kind({ applyableFixes: 1, evaluationClean: true })).toBe('continue');
  });
});

describe('a draft that was cut off (PM-11)', () => {
  it('suggests finishing it before judging it', () => {
    expect(nextStageAction({ ...base, evaluated: false, truncated: true }).kind).toBe('continue_writing');
    expect(nextStageAction({ ...base, truncated: true }).label).toBe('Continue writing');
  });

  it('still lets unsaved edits go first', () => {
    expect(nextStageAction({ ...base, truncated: true, dirty: true }).kind).toBe('save');
  });
});

describe('PM-25: no further AI pass needed', () => {
  it('says so, with the reason, instead of inviting another pass', () => {
    const action = nextStageAction({ ...base, evaluated: true, evaluationClean: true, noFurtherPassReason: 'It meets the bar.' });
    expect(action.kind).toBe('continue');
    expect(action.reason).toBe('No further AI pass needed — It meets the bar.');
  });

  it('keeps the old wording when the evaluator was not asked', () => {
    const action = nextStageAction({ ...base, evaluated: true, evaluationClean: true });
    expect(action.reason).toBe('Looks good — nothing here needs another pass.');
  });
});
