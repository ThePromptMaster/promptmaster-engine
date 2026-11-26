import { describe, expect, it } from 'vitest';

import { foldersHolding, totalWithin } from './folder-totals';
import type { ProjectFolder } from '@/types/project';

const folder = (id: string, parent_id: string | null = null): ProjectFolder => ({ id, name: id, parent_id, position: 0, user_id: 'u', created_at: '', updated_at: '' });

// 26 Nov: the sample workspace read "Nothing in … yet" over two levels of projects.
describe('projects held below a folder', () => {
  const tree = [folder('ws'), folder('client', 'ws'), folder('cfo', 'client'), folder('cto', 'client'), folder('empty', 'ws')];
  const counts = { cfo: 2, cto: 1, '': 9 };

  it('counts every level below', () => {
    expect(totalWithin('ws', tree, counts)).toBe(3);
    expect(totalWithin('empty', tree, counts)).toBe(0);
  });

  it('names the folders directly inside that hold any, with how many', () => {
    expect(foldersHolding('ws', tree, counts).map((x) => [x.folder.id, x.total])).toEqual([['client', 3]]);
  });

  it('survives a loop in the tree', () => {
    const loop = [folder('a', 'b'), folder('b', 'a')];
    expect(totalWithin('a', loop, { a: 1, b: 1 })).toBe(2);
  });
});
