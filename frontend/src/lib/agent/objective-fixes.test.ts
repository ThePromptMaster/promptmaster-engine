import { describe, expect, it } from 'vitest';

import { ANSWER_OBJECTIVE_REASON, FIX_OBJECTIVE_REASON, LIMITATION_NOTE, objectiveFixes, statedLimitation } from './objective-fixes';

const fix = (minute: number) => ({ type: 'brief_changed', reason: FIX_OBJECTIVE_REASON, created_at: `2026-11-05T23:${String(minute).padStart(2, '0')}:00Z` });

describe('how many times "Have Go fix it" has run', () => {
  it('counts every press while the user has changed nothing', () => {
    expect(objectiveFixes({ events: [fix(2), fix(10), fix(16)], versions: [], facts: [] })).toBe(3);
  });

  it("Go's own versions and other reopenings are not the user changing anything", () => {
    const events = [fix(2), { type: 'brief_changed', reason: 'Reopened and handed to Go to finish', created_at: '2026-11-05T23:03:00Z' }, fix(10)];
    const versions = [{ source_operation: 'agent_revise', created_at: '2026-11-05T23:05:00Z' }];
    expect(objectiveFixes({ events, versions, facts: [] })).toBe(2);
  });

  it('starts again after an edit of their own', () => {
    const versions = [{ source_operation: 'stage_edit', created_at: '2026-11-05T23:05:00Z' }];
    expect(objectiveFixes({ events: [fix(2), fix(10)], versions, facts: [] })).toBe(1);
  });

  it('starts again after a fact they added, but not after the fact an answer to Go records', () => {
    const fact = (via?: string) => ({ created_at: '2026-11-05T23:05:00Z', accepted_by: 'user', source_ref: via ? { via } : {} });
    expect(objectiveFixes({ events: [fix(2), fix(10)], versions: [], facts: [fact()] })).toBe(1);
    expect(objectiveFixes({ events: [fix(2), fix(10)], versions: [], facts: [fact('go answer')] })).toBe(2);
  });

  it('starts again after they tell Go how in their own words', () => {
    const answer = { type: 'brief_changed', reason: ANSWER_OBJECTIVE_REASON, created_at: '2026-11-05T23:05:00Z' };
    expect(objectiveFixes({ events: [fix(2), answer, fix(10)], versions: [], facts: [] })).toBe(1);
  });
});

describe('what a project was finished with stated as a limitation', () => {
  it('reads the limitation back, keeping a dash in its own words', () => {
    expect(statedLimitation(`${LIMITATION_NOTE}Names the desk — it does not`)).toBe('Names the desk — it does not');
    expect(statedLimitation(`${LIMITATION_NOTE}Names the desk — Finished with 1 item(s) still open: x. Reason: y`)).toBe('Names the desk');
  });

  it('any other finish has none', () => {
    expect(statedLimitation('Finished with 1 item(s) still open: x. Reason: y')).toBeNull();
    expect(statedLimitation(null)).toBeNull();
    expect(statedLimitation(LIMITATION_NOTE)).toBeNull();
  });
});
