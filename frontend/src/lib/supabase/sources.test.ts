import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listProjectSources, saveSources } from './sources';

/** One search's sources share a `created_at` (22 Oct): only `seq` orders them. */
const order = vi.fn();
let inserted: { seq: number; url: string }[] = [];
vi.mock('./client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: (...a: unknown[]) => (order(...a), Promise.resolve({ data: [], error: null })) }) }),
      insert: () => ({ select: () => Promise.resolve({ data: inserted, error: null }) }),
    }),
  }),
}));

beforeEach(() => order.mockReset());

describe('project sources keep the order they were saved in (22 Oct)', () => {
  it('lists them by seq, not by created_at', async () => {
    await listProjectSources('p1');
    expect(order).toHaveBeenCalledWith('seq', { ascending: true });
  });

  it('returns a search\'s saved sources in the order they were written, whatever order the insert returns', async () => {
    inserted = [
      { seq: 12, url: 'https://example.org/b' },
      { seq: 11, url: 'https://example.org/a' },
    ];
    const saved = await saveSources(
      { id: 'p1', user_id: 'u1' },
      [
        { url: 'https://example.org/a', title: '', excerpt: '' },
        { url: 'https://example.org/b', title: '', excerpt: '' },
      ],
      { query: 'q' }
    );
    expect(saved.map((s) => s.url)).toEqual(['https://example.org/a', 'https://example.org/b']);
  });
});
