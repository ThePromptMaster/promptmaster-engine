import { describe, expect, it } from 'vitest';

import { repairTries } from './needs';
import { creditStop, isOutOfCredits } from './credit-stop';
import type { AgentStep } from '@/types/agent';
import type { WorkflowState } from '@/lib/workflow/types';

describe('out of credit stops the run and costs no repair try (8 Nov, production)', () => {
  it('recognises the error by its code', () => {
    expect(isOutOfCredits({ code: 'insufficient_credits' })).toBe(true);
    expect(isOutOfCredits({ code: 'rate_limited' })).toBe(false);
    expect(isOutOfCredits(new Error('The OpenRouter account has run out of credit'))).toBe(false);
    expect(isOutOfCredits(null)).toBe(false);
  });

  it('is a step cut off, with the run stopped on the reason', () => {
    const o = creditStop('Out of credit.');
    expect(o.status).toBe('interrupted');
    expect(o.stop).toEqual({ status: 'blocked', reason: 'Out of credit.' });
  });

  it('does not count as a try on the stage it was repairing', () => {
    const state = { current_stage_id: 'a', stages: { a: { status: 'stale', stale: { since: 't', reason: 'r' } } } } as unknown as WorkflowState;
    const step = (status: AgentStep['status']) => ({ id: status, action_key: 'recheck_stage', status, params: { stage_id: 'a', stale_since: 't' } }) as unknown as AgentStep;
    expect(repairTries([step('interrupted'), step('interrupted')], state, new Set())).toEqual([]);
    expect(repairTries([step('failed')], state, new Set())).toEqual(['a']);
  });
});
