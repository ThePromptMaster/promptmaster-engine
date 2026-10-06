import { beforeEach, describe, expect, it, vi } from 'vitest';

const listRecommendations = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/recommendations', () => ({
  listRecommendations,
  insertRecommendation: vi.fn(),
  recordDecision: vi.fn(),
}));
const checkConflicts = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ api: { checkConflicts } }));

import { conflictContext, findInstructionConflicts } from './conflict-trail';

function row(over: Record<string, unknown>) {
  return {
    id: 'r', status: 'pending', kind: 'fix', title: 'T', instruction: 'Make it shorter.',
    scope: { kind: 'document', stage_id: 'objective' }, version_id: 'v2', category: null, ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('conflictContext: which pending proposals count as live instructions (A5)', () => {
  it('only fixes raised on the version being changed, and never a "move on" proposal', async () => {
    listRecommendations.mockResolvedValue([
      row({ id: 'live', version_id: 'v2' }),
      row({ id: 'old-head', version_id: 'v1', instruction: 'Add a table.' }),
      row({ id: 'move', kind: 'stage_transition', instruction: 'Move on to Audience.' }),
      row({ id: 'elsewhere', scope: { kind: 'document', stage_id: 'audience' } }),
      row({ id: 'settled', status: 'superseded' }),
    ]);
    const { others } = await conflictContext('p1', 'objective', [], 'v2');
    expect(others.map((o) => o.id)).toEqual(['live']);
  });

  it('with no head version known, every pending fix on the stage still counts (the old behaviour)', async () => {
    listRecommendations.mockResolvedValue([row({ id: 'a', version_id: 'v1' }), row({ id: 'b', version_id: 'v2' })]);
    const { others } = await conflictContext('p1', 'objective', ['typed earlier']);
    expect(others.map((o) => o.id)).toEqual(['a', 'b', 'chat-0']);
  });

  it('accepted and dismissed rows are the decision trail, whatever their version', async () => {
    listRecommendations.mockResolvedValue([
      row({ id: 'yes', status: 'accepted', version_id: 'v1' }),
      row({ id: 'no', status: 'dismissed', version_id: null }),
      row({ id: 'auth', status: 'accepted', scope: { kind: 'agent_authorization' } }),
    ]);
    const { decisions } = await conflictContext('p1', 'objective', [], 'v2');
    expect(decisions.map((d) => d.id)).toEqual(['yes', 'no']);
    expect(decisions[0].text).toMatch(/^Accepted: T — Make it shorter\./);
  });
});

describe('Go\'s revision toward its own stage (Sean, 2 Oct screenshot)', () => {
  const project = { id: 'p', objective: 'Write a book about lions', audience: 'General', constraints: 'Under 300 words', mode: 'architect', model: 'm' } as never;
  const args = {
    project, stageId: 'research', instruction: 'Reformat the research notes into a table: claim, source, confidence. Make it longer.',
    stage: { label: 'Research notes', instruction: 'A table of the claims: claim, source, confidence.' },
  };
  beforeEach(() => {
    listRecommendations.mockResolvedValue([]);
    checkConflicts.mockResolvedValue({ conflicts: [
      { kind: 'objective', with_id: '', with_text: 'Write a book about lions', explanation: 'A table is a different deliverable from the book.' },
    ] });
  });

  it('is not stopped by the objective or the constraints, and says so to the server', async () => {
    expect(await findInstructionConflicts({ ...args, origin: 'go' })).toEqual([]);
    expect(checkConflicts.mock.calls[0][0]).toMatchObject({ origin: 'go' });
  });

  it('the same words typed by the user are still checked against the objective', async () => {
    const found = await findInstructionConflicts(args);
    expect(found.map((c) => c.kind)).toContain('objective');
    expect(checkConflicts.mock.calls[0][0].origin).toBeUndefined();
  });
});
