import { describe, expect, it } from 'vitest';

import { auditStop, describeAudit, proposedDefault, touchesObjective, type AuditInput } from './stop-audit';

const base: AuditInput = {
  question: 'Should the sweep also cover damping ratios above 1?',
  stageLabel: 'Analysis', nextStageLabel: 'Alternatives',
  allowed: ['advance_stage', 'request_user_decision'], canAdvance: true,
  policy: 'autonomous', routine: 'handle', setAsideBefore: false, touchesObjective: false,
};

describe('auditStop (Q1b; Sean, 9 Oct: "Before interrupting the user, Go should assess")', () => {
  it('a question that does not hold a finished stage up is set aside and the work moves on', () => {
    const { audit, instead } = auditStop(base);
    expect(instead).toMatchObject({ key: 'advance_stage' });
    expect(instead?.rationale).toContain('Set aside, not dropped');
    expect(audit.proceedWith).toContain('Alternatives');
  });

  it('a stage that cannot finish without the answer asks, and says what it checked', () => {
    const { audit, instead } = auditStop({ ...base, canAdvance: false });
    expect(instead).toBeNull();
    expect(describeAudit(audit)).toMatch(/^Before asking, I checked:\n- Required work on this stage/);
    expect(audit.checked.join(' ')).toContain('Analysis cannot be finished without an answer');
  });

  it('asks when routine decisions are not handed to Go, the question is about the objective, or one was already set aside', () => {
    expect(auditStop({ ...base, routine: 'ask' }).instead).toBeNull();
    expect(auditStop({ ...base, policy: 'guided' }).instead).toBeNull();
    expect(auditStop({ ...base, touchesObjective: true }).instead).toBeNull();
    expect(auditStop({ ...base, setAsideBefore: true }).instead).toBeNull();
    expect(auditStop({ ...base, nextStageLabel: null }).instead).toBeNull();
  });

  it('reads a question about the objective or the user\'s decisions as theirs', () => {
    expect(touchesObjective('Should we relax the noon deadline?')).toBe(true);
    expect(touchesObjective('Do you approve the analysis plan?')).toBe(true);
    expect(touchesObjective('Which integrator step size is enough?')).toBe(false);
  });
});

describe('Q1b (production, 9 Oct): a routine choice with a named default is not the user\'s', () => {
  const asked = 'Please choose the exact inputs to pre-register for the computations: one pendulum length L with units, one gravity value g with units, and the amplitude set with units. If you want a default set, approve this single package: L = 1.00 m, g = 9.81 m/s^2, amplitudes = 5°, 15°, 30°, 45°, 60°, 75°.';

  it('"approve this package" is not a question about the objective', () => {
    expect(touchesObjective(asked)).toBe(false);
    expect(touchesObjective('Do you approve the analysis plan?')).toBe(true);
    expect(touchesObjective('This is your own judgment to make.')).toBe(true);
  });

  it('reads the default the question proposes', () => {
    expect(proposedDefault(asked)).toBe('L = 1.00 m, g = 9.81 m/s^2, amplitudes = 5°, 15°, 30°, 45°, 60°, 75°');
    expect(proposedDefault('Which integrator should be used?')).toBeNull();
  });
});
