import { describe, expect, it } from 'vitest';

import { latestPerKey } from './workflow';

describe('latestPerKey', () => {
  it('keeps only the newest version of each template, whatever order rows arrive in', () => {
    const rows = [
      { id: 'book-1', key: 'book', version: 1 },
      { id: 'book-2', key: 'book', version: 2 },
      { id: 'research-2', key: 'research', version: 2 },
      { id: 'research-1', key: 'research', version: 1 },
      { id: 'single-1', key: 'single_output', version: 1 },
    ];

    expect(latestPerKey(rows).map((r) => r.id)).toEqual(['book-2', 'research-2', 'single-1']);
  });

  it('is empty for no rows', () => {
    expect(latestPerKey([])).toEqual([]);
  });
});
