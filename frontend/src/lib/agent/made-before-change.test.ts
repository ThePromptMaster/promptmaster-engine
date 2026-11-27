import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendWorkflowEvent = vi.fn(async () => undefined);
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => appendWorkflowEvent(...(a as [])), listWorkflowEvents: vi.fn(async () => []) }));

import { reopenIfFactsMovedOn, type PerformContext, type StepOutcome } from './perform';
import type { WorkflowEvent } from '@/lib/workflow/types';

/**
 * L-322 (a peer's trace of Sean's 27 Nov Morrow run): a fact arrived while Go applied findings; the
 * shortlist was saved without it, and "Approve and resume" asked for the old one.
 */
const STARTED = '2026-11-27T15:37:26.100Z';
const fact = (over: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type: 'brief_changed', stage_id: 'shortlist', actor: 'user', created_at: '2026-11-27T15:37:38.700Z',
  payload: { kind: 'fact', field: 'facts', before: '- D1: Vendor A.', after: '- D1: Vendor A.\n- D2: No award has been approved.', affected: [] },
  ...over,
});
function ctx(events: WorkflowEvent[]): PerformContext {
  return {
    project: { id: 'p', user_id: 'u' }, template: { stages: [{ id: 'shortlist', label: 'Shortlist' }] }, stage: { id: 'shortlist', label: 'Shortlist' },
    run: { id: 'r' }, step: { started_at: STARTED, params: {} }, loadEvents: async () => events, afterStageEvent: vi.fn(async () => undefined),
  } as unknown as PerformContext;
}
const saved: StepOutcome = { status: 'succeeded', label: null, output: 'Applied 2 findings to Shortlist — saved as a new version.', toolsUsed: ['model'], changes: { version_ids: ['v4'] } };

beforeEach(() => appendWorkflowEvent.mockClear());

describe('a version saved from facts that changed while it was written (L-322)', () => {
  it('reopens its stage, saying so, when a fact arrived during the step', async () => {
    const out = await reopenIfFactsMovedOn(ctx([fact()]), saved);
    expect(appendWorkflowEvent).toHaveBeenCalledTimes(1);
    const [, , ev] = appendWorkflowEvent.mock.calls[0] as unknown as [string, string, { type: string; actor: string; payload: { made_before_change: boolean; affected: { stage_id: string; reason: string }[] } }];
    expect(ev).toMatchObject({ type: 'version_predates_change', actor: 'system', payload: { made_before_change: true, affected: [{ stage_id: 'shortlist' }] } });
    expect(ev.payload.affected[0].reason).toContain('D2: No award has been approved.');
    expect(out.output).toContain('stays open');
  });

  it('leaves it alone when nothing changed during the step, or the change was about another stage, or only offered', async () => {
    await reopenIfFactsMovedOn(ctx([fact({ created_at: '2026-11-27T15:30:00Z' })]), saved);
    await reopenIfFactsMovedOn(ctx([fact({ payload: { ...fact().payload, affected: [{ stage_id: 'brief', reason: 'x' }] } })]), saved);
    await reopenIfFactsMovedOn(ctx([fact({ payload: { ...fact().payload, proposed: [{ stage_id: 'shortlist' }] } })]), saved);
    // Offered from the side chat with nothing finished: no proposal list, still only offered (L-168).
    await reopenIfFactsMovedOn(ctx([fact({ payload: { ...fact().payload, offered: true } })]), saved);
    await reopenIfFactsMovedOn(ctx([fact()]), { ...saved, changes: {} });
    expect(appendWorkflowEvent).not.toHaveBeenCalled();
  });
});

describe('the event that records it (L-322, 28 Nov)', () => {
  it('is not a brief change, which only the user writes, and the projection reopens the stage it names', async () => {
    const { projectState } = await import('@/lib/workflow/engine');
    const { SINGLE_OUTPUT_V1 } = await import('@/lib/workflow/templates/single-output.v1');
    const first = SINGLE_OUTPUT_V1.stages[0].id;
    const ev = (type: string, over: Partial<WorkflowEvent> = {}): WorkflowEvent =>
      ({ type, stage_id: first, actor: 'user', created_at: '2026-11-27T21:46:00Z', payload: {}, ...over }) as WorkflowEvent;
    const state = projectState(SINGLE_OUTPUT_V1, [
      ev('project_created'),
      ev('version_predates_change', {
        actor: 'system', created_at: '2026-11-27T21:46:28Z',
        payload: { made_before_change: true, affected: [{ stage_id: first, reason: 'Brief was saved from what the project said before this change.' }] },
      }),
    ]);
    expect(state.stages[first]).toMatchObject({ status: 'stale', stale: { was: 'in_progress', reason: 'Brief was saved from what the project said before this change.' } });
  });
});
