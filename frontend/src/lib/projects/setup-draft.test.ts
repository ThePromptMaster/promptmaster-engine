import { describe, expect, it } from 'vitest';

import { describeDraft, worthKeeping, type SetupDraftState } from './setup-draft';

const base: SetupDraftState = { v: 1, step: 'ask', objective: '' };

describe('an unfinished setup is kept (U2; Sean, 7 Oct)', () => {
  it('an empty page is not worth keeping; an ask, a conversation or a design is', () => {
    expect(worthKeeping(base)).toBe(false);
    expect(worthKeeping({ ...base, objective: 'Plan a workshop' })).toBe(true);
    expect(worthKeeping({ ...base, frontDoor: { turns: [{ role: 'user', content: 'hi' }], brief: {} as never, ready: false } })).toBe(true);
    expect(worthKeeping({ ...base, designer: { open: true, description: '', design: { stages: [] } as never } })).toBe(true);
  });

  it('says what is waiting', () => {
    const s: SetupDraftState = { ...base, step: 'setup', objective: 'A workshop: schedule, budget, invitation, briefing, verification' };
    expect(describeDraft(s, '2026-10-07T12:00:00Z')).toMatch(/^You have an unfinished setup from 7 Oct, \d\d:\d\d: a setup ready to start — "A workshop/);
    expect(describeDraft({ ...s, designer: { open: true, description: 'x', design: { stages: [1, 2, 3] } as never } }, 'x')).toContain('a workflow being designed (3 stages)');
  });
});
