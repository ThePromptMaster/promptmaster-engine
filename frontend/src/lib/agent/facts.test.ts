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
