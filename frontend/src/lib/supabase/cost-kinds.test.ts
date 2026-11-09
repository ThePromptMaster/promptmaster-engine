import { describe, expect, it } from 'vitest';

import { drainOperation } from '@/lib/jobs/drain';

import { costByKind } from './project-cost';

describe('what a project cost goes on (8 Nov: baseline, revision, review and repair apart)', () => {
  it('sorts calls by what they were for, and leaves a call with no price out', () => {
    expect(
      costByKind([
        { cost_usd: '1.5', operation: 'go:draft_stage' },
        { cost_usd: 0.5, operation: 'drain:first_draft' },
        { cost_usd: 2, operation: 'go:revise_stage' },
        { cost_usd: 1, operation: 'go:evaluate_stage' },
        { cost_usd: 4, operation: 'go:recheck_stage' },
        { cost_usd: 3, operation: 'drain:repair' },
        { cost_usd: 0.25, operation: '/api/agent/next-action' },
        { cost_usd: 0.1, operation: '/api/chat-message' },
        { cost_usd: 9, operation: null },
        { cost_usd: null, operation: 'go:recheck_stage' },
      ])
    ).toEqual({ first_draft: 2, revision: 2, review: 1, repair: 7, planning: 0.25, chat: 0.1, other: 9 });
  });

  it('a section job says what it is for', () => {
    expect(drainOperation({})).toBe('drain:first_draft');
    expect(drainOperation({ continue_only: true })).toBe('drain:continue');
    const revise = { stage_label: 'x', instruction: 'y', notes: '' };
    expect(drainOperation({ revise })).toBe('drain:revision');
    expect(drainOperation({ revise: { ...revise, repair: true } })).toBe('drain:repair');
  });
});
