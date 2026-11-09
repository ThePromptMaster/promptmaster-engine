import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listConnections: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api }));

import { BOOK_V1, projectState } from '@/lib/workflow';
import { generationRequest } from '@/lib/workflow/stage-requests';
import { useProjectStore } from '@/stores/project-store';
import type { Project } from '@/types/project';

import { accountLine, accountSearchOf, forgetConnectedAccount, hasConnectedAccount, keepAccountItems } from './account-found';

const ACTIVE = { accounts: [{ id: 'a', toolkit: 'gmail', label: 'Gmail', status: 'ACTIVE', connected_at: '' }], toolkits: [] };
const ITEM = { kind: 'email' as const, source: 'Gmail', title: 'Board pack', text: 'Pack.' };

function holding(third_party: unknown[]) {
  const patchProject = vi.fn();
  const flush = vi.fn(async () => undefined);
  useProjectStore.setState({ projectId: 'p1', project: { id: 'p1', third_party } as unknown as Project, patchProject, flush });
  return { patchProject, flush };
}

describe('searching a project owner’s accounts', () => {
  beforeEach(() => {
    forgetConnectedAccount();
    api.listConnections.mockReset();
    api.listConnections.mockResolvedValue(ACTIVE);
  });

  it('asks only while the project allows it and something is connected', async () => {
    expect(await accountSearchOf({ account_search: 'on' })).toBe('on');
    expect(await accountSearchOf({ account_search: 'off' })).toBe('off');
    expect(await accountSearchOf({})).toBe('off');
    forgetConnectedAccount();
    api.listConnections.mockResolvedValue({ accounts: [{ ...ACTIVE.accounts[0], status: 'EXPIRED' }], toolkits: [] });
    expect(await accountSearchOf({ account_search: 'on' })).toBe('off');
  });

  it('does not ask for a project with the switch off', async () => {
    await accountSearchOf({ account_search: 'off' });
    expect(api.listConnections).not.toHaveBeenCalled();
  });

  it('asks once, and again after a failure', async () => {
    await hasConnectedAccount();
    await hasConnectedAccount();
    expect(api.listConnections).toHaveBeenCalledTimes(1);
    forgetConnectedAccount();
    api.listConnections.mockRejectedValueOnce(new Error('guest'));
    expect(await hasConnectedAccount()).toBe(false);
    expect(await hasConnectedAccount()).toBe(true);
  });

  it('never goes into what Go asks for, even with the switch on', () => {
    const project = { id: 'p', user_id: 'u', objective: 'x', mode: 'architect', model: '', account_search: 'on' } as unknown as Project;
    const state = projectState(BOOK_V1, [], 'objective');
    expect(generationRequest(project, BOOK_V1, state, {}, BOOK_V1.stages[0], '')).not.toHaveProperty('account_search');
  });

  it('saves what a search read beside what is held, and says what it did', async () => {
    const { patchProject, flush } = holding([{ ...ITEM, title: 'Held' }]);
    const found = await keepAccountItems('p1', { account_query: 'board', account_items: [ITEM] });
    expect(patchProject).toHaveBeenCalledWith({ third_party: [{ ...ITEM, title: 'Held' }, ITEM] });
    expect(flush).toHaveBeenCalled();
    expect(found).toEqual({ query: 'board', read: 1, kept: 1 });
    expect(accountLine(found)).toBe('Searched your accounts for “board” · read 1.');
  });

  it('keeps an item once, and a full project keeps none but the work still used them', async () => {
    const full = Array.from({ length: 20 }, (_x, i) => ({ ...ITEM, title: `Held ${i}` }));
    const { patchProject } = holding(full);
    const found = await keepAccountItems('p1', { account_query: 'board', account_items: [ITEM] });
    expect(patchProject).not.toHaveBeenCalled();
    expect(found).toMatchObject({ read: 1, kept: 0 });
  });

  it('does nothing when no search was made, and reports a failed one', async () => {
    expect(await keepAccountItems('p1', {})).toBeNull();
    const failed = await keepAccountItems('p1', { account_note: 'Could not be searched.' });
    expect(failed).toEqual({ query: '', read: 0, kept: 0, note: 'Could not be searched.' });
    expect(accountLine(failed)).toBe('Could not be searched.');
  });

  it('never throws when the save fails', async () => {
    useProjectStore.setState({ projectId: 'p1', project: { id: 'p1', third_party: [] } as unknown as Project, patchProject: vi.fn(), flush: vi.fn(async () => { throw new Error('offline'); }) });
    expect(await keepAccountItems('p1', { account_query: 'board', account_items: [ITEM] })).toMatchObject({ read: 1, kept: 0 });
  });
});
