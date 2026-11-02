import { describe, expect, it } from 'vitest';
import { draftFacts } from '@/lib/agent/facts';
import { isFailedEvaluation } from './evaluation-failure';

// The row saved on 1 Nov (tattoo memo, final_decision_memo v1).
const legacy = {
  version_id: 'v1',
  failed: undefined,
  alignment_explanation: "Something went wrong while generating. Retrying is safe. Nothing was lost — the artifact and its version history are untouched — evaluating never rewrites your work. (Technical detail: No content in response (finish_reason='length'))",
  drift_explanation: "Something went wrong while generating. (Technical detail: No content in response (finish_reason='length'))",
  clarity_explanation: "Something went wrong while generating. (Technical detail: No content in response (finish_reason='length'))",
  findings: [],
};

const real = {
  version_id: 'v1',
  alignment_explanation: 'Meets the objective.',
  drift_explanation: 'Stays on the brief.',
  clarity_explanation: 'Clear.',
  findings: [],
};

describe('a check that could not run (2 Nov, Sean)', () => {
  it('is recognised by its flag and, for rows saved before it, by the fallback wording', () => {
    expect(isFailedEvaluation({ ...real, failed: true })).toBe(true);
    expect(isFailedEvaluation(legacy)).toBe(true);
    expect(isFailedEvaluation(real)).toBe(false);
    expect(isFailedEvaluation(null)).toBe(false);
  });

  it('is never taken for a check that found something', () => {
    expect(isFailedEvaluation({ ...legacy, findings: [{ id: 'f1' }] })).toBe(false);
  });

  it('does not count as checking the version, so Go checks it again', () => {
    expect(draftFacts({ id: 'v1' }, legacy).checked).toBe(false);
    expect(draftFacts({ id: 'v1' }, real).checked).toBe(true);
  });
});
