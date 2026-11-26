// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { meanwhile } from './meanwhile';

describe('what can keep moving while Go waits (26 Nov, L-291)', () => {
  const template = { stages: ['brief', 'timeline', 'staffing', 'budget', 'commitment', 'plan'].map((id) => ({ id })) } as never;
  const done = { status: 'completed_with_artifact' };
  it('names what is finished and current with its version, and what comes after the decision', () => {
    const m = meanwhile({
      template,
      state: { stages: { brief: done, timeline: done, staffing: { status: 'stale' }, budget: done, commitment: { status: 'in_progress' }, plan: { status: 'not_started' } } } as never,
      stageId: 'commitment',
      versionOf: (id) => ({ brief: 1, timeline: 2, budget: 1 } as Record<string, number>)[id] ?? null,
      reapprove: { budget: {} },
    });
    expect(m.ready).toEqual([{ stageId: 'brief', version: 1 }, { stageId: 'timeline', version: 2 }]);
    expect(m.waiting).toEqual(['plan']);
  });
});
