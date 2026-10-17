import { beforeEach, describe, expect, it, vi } from 'vitest';

const listRecommendations = vi.hoisted(() => vi.fn());
const insertRecommendation = vi.hoisted(() => vi.fn(async (_p: string, _u: string, rec: Record<string, unknown>) => ({ id: 'rec-1', ...rec })));
const recordDecision = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/supabase/recommendations', () => ({
  listRecommendations,
  insertRecommendation,
  recordDecision,
  resolveRecommendation: vi.fn(),
}));

import { conflictContext, holdPendingChange, pendingChanges, recordConflictChoice } from './conflict-trail';
import type { Recommendation } from '@/lib/supabase/recommendations';

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

describe('a change waiting on a priority answer (16 Oct, NORTHSTAR-2)', () => {
  const conflict = { kind: 'fact' as const, with_id: 'F7', with_text: 'Cedar exception', explanation: 'Withdraws it.', source: 'model' as const };

  it('is held as a pending row that is never a stage proposal or a pending instruction', async () => {
    await holdPendingChange({ projectId: 'p1', userId: 'u1', stageId: 'output', stageLabel: 'Output', instruction: 'Withdraw the Cedar exception.', conflicts: [conflict] });
    const rec = insertRecommendation.mock.calls[0][2];
    expect(rec.status).toBeUndefined(); // pending, the default
    expect(rec.instruction).toBe('');
    expect((rec.scope as { stage_id?: string }).stage_id).toBeUndefined();
    expect(rec.category).toMatch(/^pending-change:/);
  });

  it('reads back with its stage, its words and its question', () => {
    const rows = [
      { id: 'h1', status: 'pending', category: 'pending-change:1', suggested_change: 'Withdraw the Cedar exception.', scope: { kind: 'document', pending_stage_id: 'output' }, rationale: { conflicts: [conflict] }, created_at: 't' },
      { id: 'h2', status: 'accepted', category: 'pending-change:2', suggested_change: 'Done already.', scope: { pending_stage_id: 'output' }, rationale: {}, created_at: 't' },
      { id: 'x', status: 'pending', category: null, suggested_change: 'A fix', scope: { stage_id: 'output' }, rationale: {}, created_at: 't' },
    ] as unknown as Recommendation[];
    expect(pendingChanges(rows)).toEqual([{ id: 'h1', stageId: 'output', instruction: 'Withdraw the Cedar exception.', conflicts: [conflict], createdAt: 't' }]);
  });

  it('a settled held row is not read back as an earlier decision', async () => {
    listRecommendations.mockResolvedValue([
      row({ id: 'held', status: 'accepted', category: 'pending-change:1', scope: { kind: 'document', pending_stage_id: 'objective' } }),
      row({ id: 'yes', status: 'accepted' }),
    ]);
    const { decisions, others } = await conflictContext('p1', 'objective', [], 'v2');
    expect(decisions.map((d) => d.id)).toEqual(['yes']);
    expect(others).toEqual([]);
  });

  it('keeping the record is an answer, recorded as accepted (15 Oct, HARBOR: it read as dismissed)', async () => {
    await recordConflictChoice({ projectId: 'p1', userId: 'u1', stageId: 'output', instruction: 'Treat Omar’s proposal as approved.', conflict: { ...conflict, kind: 'decision' }, controls: 'existing' });
    expect(insertRecommendation.mock.calls[0][2].status).toBe('accepted');
    expect(recordDecision).toHaveBeenCalledWith('p1', 'u1', expect.objectContaining({ decision_type: 'accept_recommendation', metadata: expect.objectContaining({ controls: 'existing' }) }));
  });
});
