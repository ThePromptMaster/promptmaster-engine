import { describe, expect, it } from 'vitest';

import { availableTransitions } from './engine';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { StageEvaluation, WorkflowState } from './types';

// 18 Nov, Sean, Hidden Innovation: the decision memo said "3 of 3 done" and
// offered Finish while two findings stayed undecided on the review and Go said
// the objective was open.
describe('Finish on the last stage', () => {
  const last = SINGLE_OUTPUT_V1.stages.at(-1)!.id;
  const state = { current_stage_id: last, stages: { [last]: { status: 'in_progress' } } } as unknown as WorkflowState;
  const ready = { canAdvance: true, criteria: [] } as unknown as StageEvaluation;
  const finish = (n?: number) => availableTransitions(SINGLE_OUTPUT_V1, state, ready, n === undefined ? {} : { blockingElsewhere: n }).find((o) => o.kind === 'finish');

  it('is plain Finish when nothing holds it up', () => {
    expect(finish()).toMatchObject({ label: 'Finish', requiresNote: false });
    expect(finish(0)).toMatchObject({ label: 'Finish', requiresNote: false });
  });
  it('is Override and finish, with a reason, while work elsewhere holds it up', () => {
    expect(finish(2)).toMatchObject({ label: 'Override and finish', requiresNote: true });
  });
});
