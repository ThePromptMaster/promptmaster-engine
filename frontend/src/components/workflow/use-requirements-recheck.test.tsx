import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const assessChange = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { assessChange: (...a: unknown[]) => assessChange(...a) } }));
vi.mock('@/lib/folders/inputs-used', () => ({
  folderKey: () => 'NEW',
  changedSince: () => ({ added: ['Candidate reports for this search go as Word documents.'], removed: ['Candidate reports go to the client as PDF.'] }),
}));
const finishedConclusions = vi.fn((tpl: { stages: { id: string }[] }) => tpl.stages.map((s) => ({ stage_id: s.id, label: s.id, summary: '' })));
vi.mock('@/lib/workflow/brief-change', () => ({ finishedConclusions: (...a: unknown[]) => finishedConclusions(...(a as [never])) }));
vi.mock('@/lib/supabase/versions', () => ({
  folderKeysOf: async (ids: string[]) => new Map(ids.map((id) => [id, 'OLD'])),
  getInputsUsed: async () => ({}),
}));

import { useRequirementsRecheck } from './use-requirements-recheck';

const template = { stages: [{ id: 'review' }, { id: 'report' }, { id: 'later' }] } as never;
const state = { current_stage_id: 'report', stages: { review: { status: 'complete' }, report: { status: 'in_progress' }, later: { status: 'not_started' } } } as never;
const bundles = { review: { versions: [{ id: 'v-review' }] }, report: { versions: [{ id: 'v-report' }] } } as never;
const project = { id: 'p', model: '', inherited: { chain: [{ id: 'f' }], rules: [], exceptions: [], inForce: [] } } as never;

describe('a folder rule changed after the work was written (L-281, 24 Nov pass)', () => {
  beforeEach(() => {
    assessChange.mockReset();
    finishedConclusions.mockClear();
  });

  it('a draft still in progress is judged too, not only finished stages', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [{ stage_id: 'report', reason: 'It says PDF.' }], calculations_hold: [] });
    const appendEvent = vi.fn(async () => undefined);
    renderHook(() => useRequirementsRecheck({ project, template, state, bundles, events: [], stageId: 'report', enabled: true, appendEvent }));
    await waitFor(() => expect(appendEvent).toHaveBeenCalled());
    expect(finishedConclusions.mock.calls[0][4]).toBe(true);
    expect(assessChange.mock.calls[0][0].stages.map((s: { stage_id: string }) => s.stage_id)).toEqual(['review', 'report']);
    expect(appendEvent.mock.calls[0][0]).toMatchObject({ type: 'brief_changed', payload: { origin: 'folder', requirements_key: 'NEW', checked: ['review', 'report'], affected: [{ stage_id: 'report' }] } });
  });

  it('a recheck another tab wrote first is read, so this tab shows it', async () => {
    assessChange.mockResolvedValue({ kind: 'fact', affected: [], calculations_hold: [] });
    const appendEvent = vi.fn(async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); });
    const refreshEvents = vi.fn(async () => []);
    renderHook(() => useRequirementsRecheck({ project, template, state, bundles, events: [], stageId: 'report', enabled: true, appendEvent, refreshEvents }));
    await waitFor(() => expect(refreshEvents).toHaveBeenCalledTimes(1));
  });
});
