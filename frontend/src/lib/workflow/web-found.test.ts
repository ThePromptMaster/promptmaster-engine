import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveSources = vi.fn();
vi.mock('@/lib/supabase/sources', () => ({ saveSources: (...a: unknown[]) => saveSources(...a) }));

import { keepFound, webAccessOf, webLine, withWebLine } from './web-found';
import { useProjectStore } from '@/stores/project-store';

const project = { id: 'p1', user_id: 'u1', sources: [] };
const row = (id: string, url: string) => ({ id, url }) as never;

beforeEach(() => {
  saveSources.mockReset();
  useProjectStore.setState({ projectId: 'p1', sources: [], lastWeb: null });
});

describe('every writer may search the web (22 Oct)', () => {
  it('sends the switch as it is, and off when unset', () => {
    expect(webAccessOf({ web_access: 'on' })).toBe('on');
    expect(webAccessOf({ web_access: 'off' })).toBe('off');
    expect(webAccessOf({})).toBe('off');
  });

  it('does nothing when the writer did not search', async () => {
    expect(await keepFound(project, {})).toBeNull();
    expect(saveSources).not.toHaveBeenCalled();
  });

  it('saves what a search found, in citation order, and tells the page', async () => {
    saveSources.mockResolvedValue([row('s1', 'https://example.org/a'), row('s2', 'https://example.org/b')]);
    const found = await keepFound(
      project,
      { web_query: 'heat pumps', web_sources: [{ url: 'https://example.org/a', title: 'A', excerpt: '' }, { url: 'https://example.org/b', title: 'B', excerpt: '' }] },
      { stageId: 'market', agentRunId: 'run1' }
    );
    expect(saveSources).toHaveBeenCalledWith(project, expect.any(Array), { query: 'heat pumps', stageId: 'market', agentRunId: 'run1' });
    expect(found).toMatchObject({ query: 'heat pumps', saved: 2, stageId: 'market' });
    expect(useProjectStore.getState().sources.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(useProjectStore.getState().lastWeb).toEqual(found);
    expect(webLine(found)).toBe('Searched the web for “heat pumps” · 2 new sources saved');
  });

  it('never fails the work over a source that will not save', async () => {
    saveSources.mockRejectedValue(new Error('policy'));
    const found = await keepFound(project, { web_query: 'heat pumps', web_sources: [{ url: 'https://example.org/a', title: '', excerpt: '' }] });
    expect(found?.note).toContain('could not be saved (policy)');
  });

  it('reports a failed search', async () => {
    const found = await keepFound(project, { web_note: 'The web search failed, so this was written from what the project holds.' });
    expect(found?.note).toMatch(/failed/);
    expect(saveSources).not.toHaveBeenCalled();
  });

  it('puts the search on the version summary', () => {
    expect(withWebLine('Drafted from the stage menu.', { projectId: 'p1', stageId: null, query: 'q', saved: 1 })).toBe(
      'Drafted from the stage menu. Searched the web for “q” · 1 new source saved'
    );
    expect(withWebLine('Drafted.', null)).toBe('Drafted.');
  });
});
