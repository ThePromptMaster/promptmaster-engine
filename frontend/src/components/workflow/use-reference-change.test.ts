import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const assessChange = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { assessChange: (...a: unknown[]) => assessChange(...a) } }));

import { useReferenceChange } from './use-reference-change';
import type { ReferenceSnapshot } from '@/types/project';

// 28 Nov (Sean, Harborlight; L-326): "I changed the source to 18 seats per
// session and clicked Update from the original … Answer v3 still showed 48
// seats and Ready to move on."
const template = { stages: [{ id: 'answer', label: 'Answer', short_label: 'Answer', group: 'production' }] } as never;
const state = { current_stage_id: 'answer', stages: { answer: { status: 'in_progress' } } } as never;
const bundles = { answer: { artifact: null, versions: [{ id: 'v3', version_number: 3, content: '48 seats for 40 people: a surplus of 8.' }] } } as never;
const ref = { id: 'r1', project_id: 'self', user_id: 'u', referenced_project_id: 'src', include_facts: true, position: 0, created_at: '' };
const snap = (seats: number): ReferenceSnapshot => ({ title: 'Harborlight Workshop — capacity source', objective: '', deliverable: 'Answer', text: `${seats} seats per session, two sessions.`, facts: [], updatedAt: '' });

describe('"Update from the original" reopens what used the old copy (L-326)', () => {
  beforeEach(() => {
    assessChange.mockReset();
  });

  it('judges the draft in progress against the change and records it', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [{ stage_id: 'answer', reason: 'It computes 48 seats from 24 per session.' }, { stage_id: 'gone', reason: 'x' }], calculations_hold: false });
    const appendEvent = vi.fn(async (e: unknown) => void e);
    const { result } = renderHook(() => useReferenceChange({ project: { model: '' }, template, state, bundles, stageId: 'answer', appendEvent }));
    await result.current(ref, snap(24), snap(18), 0);
    const req = assessChange.mock.calls[0][0];
    expect(req).toMatchObject({ field: 'earlier_stage', label: 'the linked project [R1] Harborlight Workshop — capacity source' });
    expect(req.stages.map((s: { stage_id: string }) => s.stage_id)).toEqual(['answer']);
    expect(req.after).toContain('18 seats');
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'brief_changed', stage_id: 'answer',
      payload: expect.objectContaining({
        field: 'context', origin: 'reference', kind: 'fact',
        reference: { id: 'r1', project_id: 'src', name: '[R1] Harborlight Workshop — capacity source' },
        affected: [{ stage_id: 'answer', reason: 'It computes 48 seats from 24 per session.' }],
      }),
    }));
  });

  it('an update that changed nothing records nothing', async () => {
    const appendEvent = vi.fn(async (e: unknown) => void e);
    const { result } = renderHook(() => useReferenceChange({ project: { model: '' }, template, state, bundles, stageId: 'answer', appendEvent }));
    await result.current(ref, snap(24), snap(24), 0);
    expect(assessChange).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('a check that fails still records the change, reopening nothing', async () => {
    assessChange.mockRejectedValue(new Error('down'));
    const appendEvent = vi.fn(async (e: unknown) => void e);
    const { result } = renderHook(() => useReferenceChange({ project: { model: '' }, template, state, bundles, stageId: 'answer', appendEvent }));
    await result.current(ref, snap(24), snap(18), 0);
    expect(appendEvent.mock.calls[0]![0]).toMatchObject({ type: 'brief_changed', payload: { origin: 'reference', affected: [] } });
  });
});
