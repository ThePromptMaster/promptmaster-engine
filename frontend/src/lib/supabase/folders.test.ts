import { describe, expect, it, vi } from 'vitest';

import { descendantsOf, flattenTree, folderTree } from './folders';
import { listProjects, moveProject } from './projects';
import type { ProjectFolder } from '@/types/project';

function makeSupabase() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update', 'insert', 'delete']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    });
  }
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return { client: { from: vi.fn((table: string) => (calls.push({ method: 'from', args: [table] }), builder)) }, calls };
}

const supa = vi.hoisted(() => ({ current: null as ReturnType<typeof makeSupabase> | null }));
vi.mock('./client', () => ({ createClient: () => supa.current!.client }));

const folder = (id: string, name: string, parent_id: string | null = null, position = 0): ProjectFolder => ({
  id, name, parent_id, position, user_id: 'u', created_at: '', updated_at: '',
});

describe('folders for projects (client, 21 Oct, email 5)', () => {
  it('lists one folder on the server, or the Unfiled ones, so a folder past the first page is not empty', async () => {
    supa.current = makeSupabase();
    await listProjects(50, 'f1');
    expect(supa.current.calls).toContainEqual({ method: 'eq', args: ['folder_id', 'f1'] });

    supa.current = makeSupabase();
    await listProjects(50, 'unfiled');
    expect(supa.current.calls).toContainEqual({ method: 'is', args: ['folder_id', null] });

    supa.current = makeSupabase();
    await listProjects();
    expect(supa.current.calls.some((c) => c.args[0] === 'folder_id')).toBe(false);
  });

  it('moves a project by its folder alone', async () => {
    supa.current = makeSupabase();
    await moveProject('p1', 'f2');
    expect(supa.current.calls).toContainEqual({ method: 'update', args: [{ folder_id: 'f2' }] });
    expect(supa.current.calls).toContainEqual({ method: 'eq', args: ['id', 'p1'] });
  });

  it('builds the tree in order, with depths', () => {
    const tree = folderTree([folder('b', 'Books', null, 1), folder('a', 'Audits', null, 0), folder('c', 'Drafts', 'b'), folder('d', 'Old', 'c')]);
    expect(flattenTree(tree).map((f) => [f.name, f.depth])).toEqual([
      ['Audits', 0],
      ['Books', 0],
      ['Drafts', 1],
      ['Old', 2],
    ]);
  });

  it('shows a folder whose parent is gone at the top, and never loops', () => {
    const tree = folderTree([folder('x', 'Orphan', 'missing'), folder('p', 'P', 'q'), folder('q', 'Q', 'p')]);
    expect(flattenTree(tree).map((f) => f.name)).toContain('Orphan');
  });

  it('knows a folder and everything under it', () => {
    const all = [folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b'), folder('d', 'D')];
    expect([...descendantsOf(all, 'a')].sort()).toEqual(['a', 'b', 'c']);
  });
});
