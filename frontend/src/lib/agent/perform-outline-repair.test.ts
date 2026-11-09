import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviseOutline = vi.fn();
const commitOutlineVersion = vi.fn(async () => ({ id: 'v2', version_number: 2, artifact_id: 'a' }));
const carryOutlineApproval = vi.fn(async () => undefined);
const appendWorkflowEvent = vi.fn(async () => undefined);
const materialiseOutlineInto = vi.fn(async () => undefined);
vi.mock('@/lib/api/client', () => ({ api: { reviseOutline: (...a: unknown[]) => reviseOutline(...a) } }));
vi.mock('@/lib/supabase/outline', () => ({
  approvedOutlineVersionId: () => 'v1',
  commitOutlineVersion: (...a: unknown[]) => (commitOutlineVersion as (...x: unknown[]) => unknown)(...a),
  carryOutlineApproval: (...a: unknown[]) => (carryOutlineApproval as (...x: unknown[]) => unknown)(...a),
}));
vi.mock('@/lib/outline/actions', () => ({ materialiseOutlineInto: (...a: unknown[]) => (materialiseOutlineInto as (...x: unknown[]) => unknown)(...a) }));
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => (appendWorkflowEvent as (...x: unknown[]) => unknown)(...a), listWorkflowEvents: vi.fn(async () => []) }));
vi.mock('@/lib/supabase/sources', () => ({ saveSources: vi.fn(async () => []) }));

import { performStep, type PerformContext } from './perform';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';

const outlineStage = BOOK_V1.stages.find((s) => s.renderer === 'outline')!;
const draftingStage = BOOK_V1.stages.find((s) => s.renderer === 'long_form')!;
const doc = { schema: 1, items: [{ id: 'c1', title: 'Brief', abstract: 'Budget $60,000.' }, { id: 'c2', title: 'Plan', abstract: 'Stays.' }], orphans: [], forked_from_version_id: null };

function ctx(routine: string) {
  return {
    project: { id: 'p', user_id: 'u', objective: 'x', mode: 'architect', facts: [], data_files: [], sources: [], web_access: 'off', routine_decisions: routine },
    template: BOOK_V1,
    state: { current_stage_id: draftingStage.id, stages: { [outlineStage.id]: { status: 'stale', stale: { reason: 'The budget moved to $58,000.' } } } },
    stage: draftingStage,
    bundles: {
      [outlineStage.id]: { artifact: { id: 'a', stage_id: outlineStage.id }, versions: [{ id: 'v1', version_number: 1, content: JSON.stringify(doc), source_operation: 'agent_outline' }] },
      [draftingStage.id]: { artifact: { id: 'd', stage_id: draftingStage.id, long_form: { outline: [] } }, versions: [] },
    },
    context: { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: true, sections: {}, findings: {}, manualChecks: {} },
    approvedOutline: [], run: { id: 'run1', policy: 'autonomous' },
    step: { action_key: 'recheck_stage', params: { stage_id: outlineStage.id }, rationale: 'Reopened.' },
    digest: { recent_steps: [] }, approvedByUser: false, deliverableDone: false,
    afterStageEvent: async () => undefined, loadEvents: async () => [], refresh: async () => undefined,
    appendStageVersion: async () => ({ id: 'x' }),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
}

beforeEach(() => {
  for (const f of [reviseOutline, commitOutlineVersion, carryOutlineApproval, appendWorkflowEvent, materialiseOutlineInto]) f.mockClear();
  reviseOutline.mockResolvedValue({ items: [{ id: 'c1', title: 'Brief', abstract: 'Budget $58,000.' }], restructure: '' });
});

describe('Go repairs a reopened chapter plan (8 Nov, production)', () => {
  it('keeps every chapter, carries the approval, and closes the stage with the new version as evidence', async () => {
    const out = await performStep(ctx('handle'));
    expect(out.status).toBe('succeeded');
    expect(out.output).toContain('your approval carries to it');
    const saved = (commitOutlineVersion.mock.calls as unknown as [unknown, typeof doc][])[0][1];
    expect(saved.items.map((i) => [i.id, i.abstract])).toEqual([['c1', 'Budget $58,000.'], ['c2', 'Stays.']]);
    expect((carryOutlineApproval.mock.calls as unknown as [{ carriedFrom: string }][])[0][0].carriedFrom).toBe('v1');
    expect(materialiseOutlineInto).toHaveBeenCalledOnce();
    expect((appendWorkflowEvent.mock.calls as unknown as [string, string, { type: string; payload: { evidence_version_id: string } }][])[0][2]).toMatchObject({ type: 'stage_marked_complete', payload: { evidence_version_id: 'v2' } });
  });

  it('what the user typed on the stuck card goes into the repair', async () => {
    const c = ctx('handle');
    (c.step as { params: Record<string, unknown> }).params.user_note = 'Keep the eight documents; only the budget moved.';
    await performStep(c);
    expect((reviseOutline.mock.calls as unknown as [{ reason: string }][])[0][0].reason).toContain('The user says what to fix: Keep the eight documents; only the budget moved.');
  });

  it('under "ask me" it saves the update and leaves the approval to the user', async () => {
    const out = await performStep(ctx('ask'));
    expect(out.output).toContain('your approval is still needed');
    expect(carryOutlineApproval).not.toHaveBeenCalled();
    expect(appendWorkflowEvent).not.toHaveBeenCalled();
  });

  it('a change to the chapters themselves is left to the user, and nothing is saved', async () => {
    reviseOutline.mockResolvedValue({ items: [], restructure: 'A ninth document is needed.' });
    const out = await performStep(ctx('handle'));
    expect(out.status).toBe('failed');
    expect(out.output).toContain('A ninth document is needed.');
    expect(commitOutlineVersion).not.toHaveBeenCalled();
  });
});
