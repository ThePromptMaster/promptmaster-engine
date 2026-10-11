import { describe, expect, it } from 'vitest';

import { stepActionLabel, whatApprovalDoes } from './actions';

const summary = { label: 'Final review', transitions: { default_next: null } };
const output = { label: 'Output', transitions: { default_next: 'realign' } };

describe('a step says what approving it does (Sean, 10 Oct, email 6.3)', () => {
  it('on the last stage, moving on is finishing it', () => {
    expect(stepActionLabel('advance_stage', summary)).toBe('Mark the last stage complete');
    expect(whatApprovalDoes('advance_stage', summary)).toBe('Marks Final review complete. It is the last stage, so nothing follows it.');
  });
  it('elsewhere it names the next stage', () => {
    expect(stepActionLabel('advance_stage', output)).toBe('Move to the next stage');
    expect(whatApprovalDoes('advance_stage', output, 'Realignment')).toBe('Marks Output complete and moves the project on to Realignment. No document changes.');
  });
  it('a check changes no document', () => {
    expect(whatApprovalDoes('declare_objective_complete', output)).toMatch(/No document changes\.$/);
    expect(whatApprovalDoes('evaluate_stage', output)).toBe('Runs one AI check of Output and records it. No document changes.');
  });
});
