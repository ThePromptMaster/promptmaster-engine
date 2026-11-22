import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { projectState } from '@/lib/workflow/engine';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import type { Project, ProjectFact } from '@/types/project';
import { useBriefChange } from './use-brief-change';

vi.mock('@/lib/api/client', () => ({ api: { assessChange: vi.fn(async () => ({ affected: [], kind: 'fact', calculations_hold: true })) } }));

const fact = (id: string, statement: string, ref: Record<string, unknown> = {}, extra: Partial<ProjectFact> = {}): ProjectFact =>
  ({ id, statement, subject: null, kind: 'fact', source_kind: 'user_edit', source_ref: ref, retired_at: null, supersedes: null, created_at: '2026-11-22T00:36:20Z', ...extra }) as unknown as ProjectFact;

afterEach(() => vi.useRealTimers());

describe('a fact change that concerns the chosen option takes the decision back (L-272, 21 Nov, Sean)', () => {
  it('unticks the approval, then reopens its stage with the reason, on the event', async () => {
    vi.useFakeTimers();
    const bOld = fact('b', 'Option B: two vendors; $49,000 equipment and installation + $6,000 training; all three sites live by December 18');
    const decision = fact('d', 'Decided by the user — on "I choose the option to approve" (Review): I approve Option B at $60,000.', {
      criterion_id: 'review.approved', stage_id: 'review', choice: 'I approve Option B at $60,000.',
    }, { subject: 'Decision' });
    const base = { id: 'p', user_id: 'u', status: 'active', objective: 'Memo', constraints: '', output_format: '', audience: '', manual_checks: { 'review.approved': true } } as unknown as Project;
    const state = projectState(SINGLE_OUTPUT_V1, []);
    const order: string[] = [];
    const appendEvent = vi.fn(async (e: { payload?: Record<string, unknown> }) => { order.push('event'); return e; });
    const onDecisionSetAside = vi.fn(async () => { order.push('untick'); });
    const props = { template: SINGLE_OUTPUT_V1, state, bundles: {}, stageId: 'review', appendEvent, enabled: true, onDecisionSetAside };
    const { rerender } = renderHook((p: { project: Project }) => useBriefChange({ ...props, project: p.project }), {
      initialProps: { project: { ...base, facts: [bOld, decision] } },
    });
    const bNew = fact('b2', 'Option B: two vendors; $49,000 equipment and installation + $7,500 training; all three sites live by December 18', {}, { supersedes: 'b' });
    rerender({ project: { ...base, facts: [{ ...bOld, retired_at: '2026-11-22T00:50:13Z' }, decision, bNew] } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(onDecisionSetAside).toHaveBeenCalledWith(expect.objectContaining({ criterionId: 'review.approved', stageId: 'review' }));
    expect(order).toEqual(['untick', 'event']);
    const payload = appendEvent.mock.calls[0][0].payload as { affected: { stage_id: string; reason: string }[]; decisions_set_aside: unknown[] };
    expect(payload.decisions_set_aside).toHaveLength(1);
    expect(payload.affected).toEqual([expect.objectContaining({ stage_id: 'review', reason: expect.stringContaining('set aside until the user decides again') })]);
  });
});
