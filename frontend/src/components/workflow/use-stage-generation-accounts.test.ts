import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BOOK_V1, projectState } from '@/lib/workflow';
import type { Project } from '@/types/project';

const api = vi.hoisted(() => ({ generateStageArtifact: vi.fn(), listConnections: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api }));

import { forgetConnectedAccount } from '@/lib/connections/account-found';
import { useProjectStore } from '@/stores/project-store';

import { useStageGeneration } from './use-stage-generation';

const objective = BOOK_V1.stages[0];
const base = { id: 'p1', user_id: 'u1', objective: 'A book', audience: '', constraints: '', output_format: '', mode: 'architect', model: '', workflow: 'book', stage: objective.id, third_party: [] };
const ITEM = { kind: 'email', source: 'Gmail', title: 'Board pack', text: 'Pack.' };

function draft(project: Project) {
  const append = vi.fn(async () => undefined);
  const state = projectState(BOOK_V1, [], objective.id);
  renderHook(() => useStageGeneration({ project, template: BOOK_V1, state: { ...state, current_stage_id: objective.id }, stage: objective, bundles: {}, enabled: true, appendStageVersion: append }));
  return append;
}

describe('a draft the person asked for may search their accounts (8 Nov)', () => {
  const patchProject = vi.fn();
  const flush = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    forgetConnectedAccount();
    api.listConnections.mockResolvedValue({ accounts: [{ id: 'a', toolkit: 'gmail', label: 'Gmail', status: 'ACTIVE', connected_at: '' }], toolkits: [] });
    api.generateStageArtifact.mockResolvedValue({ content: 'The draft [T1].', finish_reason: 'stop', model_used: 'm', account_query: 'board', account_items: [ITEM] });
    useProjectStore.setState({ projectId: 'p1', project: { ...base } as unknown as Project, patchProject, flush });
  });

  it('asks for it, saves what was read before the draft, and says so on the version', async () => {
    const append = draft({ ...base, account_search: 'on' } as unknown as Project);
    await waitFor(() => expect(append).toHaveBeenCalled());
    expect(api.generateStageArtifact.mock.calls[0][0].account_search).toBe('on');
    expect(patchProject).toHaveBeenCalledWith({ third_party: [ITEM] });
    expect(patchProject.mock.invocationCallOrder[0]).toBeLessThan(append.mock.invocationCallOrder[0]);
    expect(((append.mock.calls[0] as unknown[])[2] as { change_summary: string }).change_summary).toContain('Searched your accounts for “board” · read 1.');
  });

  it('does not ask with the switch off', async () => {
    api.generateStageArtifact.mockResolvedValue({ content: 'The draft.', finish_reason: 'stop', model_used: 'm' });
    const append = draft({ ...base, account_search: 'off' } as unknown as Project);
    await waitFor(() => expect(append).toHaveBeenCalled());
    expect(api.generateStageArtifact.mock.calls[0][0].account_search).toBe('off');
    expect(patchProject).not.toHaveBeenCalled();
  });
});
