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
const recordFacts = vi.hoisted(() => vi.fn(async (_p: unknown, facts: Record<string, unknown>[]) => facts.map((f, i) => ({ id: `new-${i}`, ...f }))));
const supersedeFact = vi.hoisted(() => vi.fn(async (_p: unknown, old: { id: string }, statement: string, from: Record<string, unknown>, kind: string) => ({ id: 'next', supersedes: old.id, statement, source_ref: from, source_kind: kind })));
vi.mock('@/lib/supabase/facts', () => ({ recordFacts, supersedeFact }));

import { conflictContext, holdPendingChange, pendingChanges, recordConflictChoice, recordReportedApproval, reportedApprovalStatement } from './conflict-trail';
import { factCitedAs } from './facts';
import type { ProjectFact } from '@/types/project';
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


// L-263 (Sean, 19 Nov): "If it lets me report an actual director approval, it
// should explicitly request that confirmation and record its source."
describe('an approval the user confirms is recorded with its source', () => {
  const fact = (id: string, statement: string, extra: Partial<ProjectFact> = {}) =>
    ({ id, statement, kind: 'fact', source_kind: 'brief', source_ref: {}, accepted_by: 'user', supersedes: null, retired_at: null, created_at: '2026-11-20T00:00:00Z', ...extra }) as unknown as ProjectFact;
  const facts = [fact('a', 'Each session holds at most eight employees.'), fact('b', 'The operations director’s launch authorization is pending.')];
  const pending = {
    kind: 'fact' as const, with_id: 'F2', with_text: 'The operations director’s launch authorization is pending.', source: 'model' as const,
    explanation: 'The trainer cannot give it.', protects_approval: true, approver: 'the operations director',
  };
  const report = { approver: 'the operations director', source: 'Director’s email of 19 Nov' };

  it('reads "F2" as the check numbered it, and only while the statement still matches', () => {
    expect(factCitedAs('F2', pending.with_text, facts)?.id).toBe('b');
    expect(factCitedAs('F2', 'Something else.', facts)).toBeNull();
    expect(factCitedAs('F9', pending.with_text, facts)).toBeNull();
    expect(factCitedAs('d1', pending.with_text, facts)).toBeNull();
  });

  it('replaces the fact it cited, in code words, marked as the user’s confirmation with its source', async () => {
    await recordReportedApproval({ project: { id: 'p1', user_id: 'u1', facts }, conflict: pending, report, instruction: 'From the trainer: mark it approved.', today: new Date('2026-11-20T12:00:00Z') });
    expect(recordFacts).not.toHaveBeenCalled();
    const [, old, statement, ref, kind] = supersedeFact.mock.calls[0];
    expect(old.id).toBe('b');
    expect(statement).toBe('The operations director has given the approval the record was waiting for ("The operations director’s launch authorization is pending."): confirmed by the user on 20 Nov 2026; source: Director’s email of 19 Nov.');
    expect(ref).toMatchObject({ via: 'approval_confirmed', approval: true, approved_by: 'the operations director', approval_source: 'Director’s email of 19 Nov', confirmed_by_user: true });
    expect(kind).toBe('user_edit');
  });

  it('records a new fact when the conflict cited no fact', async () => {
    await recordReportedApproval({ project: { id: 'p1', user_id: 'u1', facts }, conflict: { ...pending, kind: 'objective', with_id: '' }, report, instruction: 'x' });
    expect(supersedeFact).not.toHaveBeenCalled();
    expect(recordFacts.mock.calls[0][1][0]).toMatchObject({ kind: 'fact', source_kind: 'user_edit', source_ref: { approval_source: 'Director’s email of 19 Nov' } });
  });

  it('names nobody when the record named nobody', () => {
    expect(reportedApprovalStatement({ ...pending, approver: '' }, { approver: '', source: 'Board minutes' }, '20 Nov 2026'))
      .toMatch(/^The approval the record was waiting for \("The operations director’s launch authorization is pending\."\) has been given: confirmed by the user on 20 Nov 2026; source: Board minutes\.$/);
  });

  it('the decision trail says whose approval, on whose word, and where it is recorded', async () => {
    await recordConflictChoice({ projectId: 'p1', userId: 'u1', stageId: 'package', instruction: 'From the trainer: mark it approved.', conflict: pending, controls: 'new', approval: report });
    expect(insertRecommendation.mock.calls[0][2].title).toBe("Recorded the operations director's approval on the user's confirmation (source: Director’s email of 19 Nov), for the instruction: From the trainer: mark it approved.");
    expect(recordDecision).toHaveBeenCalledWith('p1', 'u1', expect.objectContaining({
      metadata: expect.objectContaining({ controls: 'new', approval_confirmed: true, approver: 'the operations director', approval_source: 'Director’s email of 19 Nov' }),
    }));
  });
});
