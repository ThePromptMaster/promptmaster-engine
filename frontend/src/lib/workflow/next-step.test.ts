import { describe, expect, it } from 'vitest';

import { nextAction, type NextActionInput } from './next-step';

const base: NextActionInput = {
  finalized: false, canAct: true, heldChanges: 0, reopenedHere: false, awaitingUpdate: [], goActive: false, run: null, onCurrentStage: false,
};

describe('one next action, on whichever stage is open (17 Oct, Sean, emails 2.2 and 9)', () => {
  it('a reopened stage and a change awaiting updates are both "Apply and continue"', () => {
    expect(nextAction({ ...base, reopenedHere: true, reopenedLabel: 'Output' })).toMatchObject({ kind: 'apply_continue_reopened', label: 'Apply and continue' });
    expect(nextAction({ ...base, awaitingUpdate: ['Input', 'Review'] })).toMatchObject({
      kind: 'apply_continue', label: 'Apply and continue', why: 'Input, Review need updating after your change; Go does it and carries on.',
    });
  });

  it('a held change has its own notice; a finished project and a read-only view have nothing', () => {
    expect(nextAction({ ...base, heldChanges: 1, awaitingUpdate: ['Input'] })).toBeNull();
    expect(nextAction({ ...base, finalized: true, awaitingUpdate: ['Input'] })).toBeNull();
    expect(nextAction({ ...base, canAct: false, awaitingUpdate: ['Input'] })).toBeNull();
  });

  it('a paused run is answered or resumed from another stage, and left to Go\'s panel on the current one', () => {
    const run = { status: 'awaiting_decision', ended_at: null, hasNeed: true, asking: false };
    expect(nextAction({ ...base, run })).toMatchObject({ kind: 'answer_go', label: "Answer Go's question" });
    expect(nextAction({ ...base, run: { ...run, hasNeed: false } })).toMatchObject({ kind: 'resume', label: 'Resume' });
    expect(nextAction({ ...base, run, onCurrentStage: true })).toBeNull();
    expect(nextAction({ ...base, run: { ...run, ended_at: '2026-10-18T00:00:00Z' } })).toBeNull();
  });

  it('while Go works, the bar says so instead of offering a button', () => {
    expect(nextAction({ ...base, goActive: true, goWorkingOn: 'Output', awaitingUpdate: ['Input'] })).toEqual({ kind: 'working', label: 'Go is working on Output…', why: '' });
  });
});
