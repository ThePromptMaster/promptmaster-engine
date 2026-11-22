/**
 * A sign-off on later work waits for the choice it records (L-277 follow-up, 22 Nov,
 * production pass on the vendor example): after a quote change set the choice aside and
 * Go updated the work, the run stopped on the final memo's sign-off, and the choice was
 * listed second under "Also waiting on you".
 */
import { describe, expect, it } from 'vitest';

import { earlierChoiceWaiting, needsUser } from './needs';

const template = {
  stages: [
    { id: 'costs', label: 'Costs', renderer: 'prose', exit_criteria: [{ id: 'costs.written', label: 'Costs is written', check: 'auto', blocking: true }] },
    { id: 'approve', label: 'Approve an option', renderer: 'prose', exit_criteria: [{ id: 'approve.approved', label: 'I choose the box-office system to buy', check: 'manual', blocking: true, authority: 'reserved' }] },
    { id: 'final', label: 'Final memo', renderer: 'prose', exit_criteria: [{ id: 'final.approved', label: 'I approve this memo to send to the board', check: 'manual', blocking: true, authority: 'reserved' }] },
  ],
} as never;
const state = (approve: string) => ({ stages: { costs: { status: 'completed_with_artifact' }, approve: { status: approve }, final: { status: 'in_progress' } } }) as never;

describe('the choice before the sign-off', () => {
  it('finds a reopened choice before the stage in hand; not a given one, a sign-off, or a finished stage', () => {
    expect(earlierChoiceWaiting(template, state('in_progress'), {}, 'final')).toEqual({ stageId: 'approve', criterionId: 'approve.approved', label: 'I choose the box-office system to buy' });
    expect(earlierChoiceWaiting(template, state('in_progress'), { 'approve.approved': true }, 'final')).toBeNull();
    expect(earlierChoiceWaiting(template, state('completed_with_artifact'), {}, 'final')).toBeNull();
    expect(earlierChoiceWaiting(template, state('in_progress'), {}, 'approve')).toBeNull();
  });

  it('Go asks for the choice, not for the final memo\'s sign-off', () => {
    const final = (template as { stages: { id: string }[] }).stages[2] as never;
    const unmet = [{ id: 'final.approved', label: 'I approve this memo to send to the board', manual: true, blocking: true }];
    const input = {
      state: state('in_progress'), stage: final, facts: {} as never, policy: 'autonomous' as const, outlineStageId: null, allowed: [] as string[],
      stageEvaluation: { stageId: 'final', canAdvance: false, criteria: [], unmet } as never, routine: 'handle' as const,
    };
    expect(needsUser({ ...input, earlierChoice: earlierChoiceWaiting(template, state('in_progress'), {}, 'final') })).toMatchObject({
      kind: 'tick_criterion', stageId: 'approve', criterionId: 'approve.approved',
    });
    // With the choice made, the sign-off is asked as before.
    expect(needsUser({ ...input, earlierChoice: null })).toMatchObject({ kind: 'tick_criterion', stageId: 'final', criterionId: 'final.approved' });
  });
});
