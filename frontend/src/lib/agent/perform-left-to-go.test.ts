import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentTriage = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { agentTriage: (...a: unknown[]) => agentTriage(...a) } }));
vi.mock('@/lib/workflow/conflict-trail', () => ({ findInstructionConflicts: async () => [] }));

import { performStep, type PerformContext } from './perform';
import { LEFT_TO_GO_STEP } from './actions';
import { carryThisRun } from './manuscript-fixes';
import { BOOK_V1 } from '@/lib/workflow';
import { parseItems, serializeItems } from '@/lib/workflow/stage-artifact';

/**
 * 18 Nov (Sean, Hidden Innovation): Go asked on the decision memo whether to
 * accept review findings h16 and h17. "Do whatever is best" rewrote the memo
 * to say both were accepted; the review still had them undecided, so neither
 * fix reached the manuscript and Go asked again. The answer decides the rows
 * on their own stage, as the user's.
 */
const review = BOOK_V1.stages.find((s) => s.renderer === 'review' && s.id !== 'outline_approval')!;
const memo = BOOK_V1.stages.at(-1)!;
const ROWS = [
  { id: 'h1', finding: 'Already decided', severity: 'minor', status: 'accepted', status_source: 'user' },
  { id: 'h16', finding: 'The novelty claim should be conditional', severity: 'major' },
  { id: 'h17', finding: 'Define the false-link parameter the same way in every chapter', severity: 'major' },
];
const appendStageVersion = vi.fn(async () => ({ id: 'review-v14' }));

function ctx(params: Record<string, unknown>): PerformContext {
  return {
    project: { id: 'p', user_id: 'u', objective: 'A research programme', model: 'm', facts: [], data_files: [], sources: [], manual_checks: {}, manual_check_versions: {} },
    template: BOOK_V1,
    state: { current_stage_id: memo.id, stages: {} },
    stage: memo,
    bundles: { [review.id]: { artifact: null, versions: [{ id: 'review-v13', version_number: 13, content: serializeItems(ROWS), source_operation: 'agent_triage', created_at: '2026-11-17T21:59:20Z' }] } },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [],
    run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: LEFT_TO_GO_STEP, params, rationale: '' },
    digest: { recent_steps: [] },
    approvedByUser: false,
    deliverableDone: false,
    appendStageVersion,
    afterStageEvent: async () => undefined,
    loadEvents: async () => [],
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

const saved = () => parseItems((appendStageVersion.mock.calls[0] as unknown as [string, string, { content: string }])[2].content)!;
const rows = [{ id: 'h16', stageId: review.id }, { id: 'h17', stageId: review.id }];

beforeEach(() => {
  agentTriage.mockReset();
  appendStageVersion.mockClear();
});

describe('findings left to Go', () => {
  it("are decided on the review, as the user's, and nothing else is touched", async () => {
    agentTriage.mockResolvedValue({ decisions: [
      { id: 'h16', status: 'accepted', reason: 'Keeps the claim within what the evidence shows.' },
      { id: 'h17', status: 'accepted', reason: 'One definition across chapters.' },
      { id: 'h1', status: 'rejected', reason: 'not asked' },
    ], model_used: 'm' });
    const out = await performStep(ctx({ rows }));
    expect(out.status).toBe('succeeded');
    expect((appendStageVersion.mock.calls[0] as unknown as [string])[0]).toBe(review.id);
    const items = saved();
    expect(items.find((i) => i.id === 'h16')).toMatchObject({ status: 'accepted', status_source: 'user' });
    expect(items.find((i) => i.id === 'h16')!.reason).toMatch(/^Left to Go by you — Keeps the claim/);
    expect(items.find((i) => i.id === 'h17')).toMatchObject({ status: 'accepted', status_source: 'user' });
    expect(items.find((i) => i.id === 'h1')).toMatchObject({ status: 'accepted', status_source: 'user' });
    // Only the named, undecided rows went to the model.
    expect((agentTriage.mock.calls[0][0] as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(['h16', 'h17']);
    expect(out.output).toContain('Decided as you left it to Go');
  });

  it('a chosen answer is applied as given, with no model call', async () => {
    const out = await performStep(ctx({ rows, decisions: [{ id: 'h16', status: 'accepted' }, { id: 'h17', status: 'rejected' }], answer: 'Accept h16, reject h17' }));
    expect(agentTriage).not.toHaveBeenCalled();
    expect(out.status).toBe('succeeded');
    const items = saved();
    expect(items.find((i) => i.id === 'h16')).toMatchObject({ status: 'accepted', status_source: 'user' });
    expect(items.find((i) => i.id === 'h17')).toMatchObject({ status: 'rejected', status_source: 'user' });
  });

  it('when nothing usable comes back, it asks on the rows and does not offer "do whatever is best" again', async () => {
    agentTriage.mockResolvedValue({ decisions: [], model_used: 'm' });
    const out = await performStep(ctx({ rows }));
    expect(appendStageVersion).not.toHaveBeenCalled();
    expect(out.stop?.status).toBe('awaiting_decision');
    expect(out.needs).toMatchObject({ kind: 'answer_question', rows, repeat: true });
  });
});

describe('carried into the work', () => {
  it("a row the user left to Go is the user's, so the carry limit on Go's own rows never drops it", () => {
    const fix = (byUser: boolean) => ({ stageId: review.id, stageLabel: review.label, id: 'h16', text: 'x', byUser }) as never;
    const rounds = [1, 2].map(() => ({ action_key: 'recheck_stage', status: 'succeeded', params: { accepted_fixes: ['x'] } })) as never;
    expect(carryThisRun([fix(true), fix(false)], rounds)).toHaveLength(1);
  });
});
