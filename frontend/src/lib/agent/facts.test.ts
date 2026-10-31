import { describe, expect, it } from 'vitest';
import { draftFacts } from './facts';

describe('draftFacts: cut off means cut off (6 Oct, production)', () => {
  it('a draft that hit the length limit is cut off', () => {
    expect(draftFacts({ id: 'v1', finish_reason: 'length' }, null)).toEqual({ truncated: true, checked: false });
  });

  it('a check calling a finished draft "incomplete" does not make it cut off', () => {
    const evaluation = { version_id: 'v1', completeness_status: 'incomplete' };
    expect(draftFacts({ id: 'v1', finish_reason: 'stop' }, evaluation)).toEqual({ truncated: false, checked: true });
  });
});

describe('Go stops continuing a draft that stays cut off (31 Oct)', () => {
  it('after two continuations still cut off, the draft is left for the user', () => {
    const v = (op: string, finish: string | null) => ({ source_operation: op, finish_reason: finish });
    const head = { id: 'v3', finish_reason: 'length' };
    expect(draftFacts(head, null, [v('stage_draft', 'length'), v('continuation', 'length')]).truncated).toBe(true);
    expect(draftFacts(head, null, [v('stage_draft', 'length'), v('continuation', 'length'), v('continuation', 'length')]).truncated).toBe(false);
  });

  it('a revision that is itself cut off does not start the count again', () => {
    const v = (op: string, finish: string | null) => ({ source_operation: op, finish_reason: finish });
    const head = { id: 'v5', finish_reason: 'length' };
    expect(draftFacts(head, null, [v('continuation', 'length'), v('continuation', 'length'), v('agent_apply', 'length')]).truncated).toBe(false);
    expect(draftFacts(head, null, [v('continuation', 'length'), v('continuation', null), v('agent_apply', 'length')]).truncated).toBe(true);
  });
});
