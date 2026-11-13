import { describe, expect, it } from 'vitest';

import { cells, tablesIn } from './markdown-tables';

describe('the tables a document holds', () => {
  const doc = [
    '# Decision package',
    '',
    'Some words.',
    '',
    '## Shortlist',
    '',
    '| Candidate | Status | Fee |',
    '|---|:--|--:|',
    '| **Avery** | Interviewed | 1200 |',
    '| Morgan | `Interviewed` | 1,200 |',
    '',
    '**Decision log**',
    '',
    '| # | Entry |',
    '| --- | --- |',
    '| 1 | Option A \\| Option B were open |',
    '',
    '```',
    '| not | a table |',
    '|---|---|',
    '| it is | code |',
    '```',
  ].join('\n');

  it('reads each table with the heading it sits under, header first, rule rows left out', () => {
    const tables = tablesIn(doc);
    expect(tables.map((t) => t.title)).toEqual(['Shortlist', 'Decision log']);
    expect(tables[0].rows).toEqual([
      ['Candidate', 'Status', 'Fee'],
      ['Avery', 'Interviewed', '1200'],
      ['Morgan', 'Interviewed', '1,200'],
    ]);
  });

  it('keeps a pipe written inside a cell, and skips rows inside a code block', () => {
    const tables = tablesIn(doc);
    expect(tables).toHaveLength(2);
    expect(tables[1].rows[1]).toEqual(['1', 'Option A | Option B were open']);
    expect(cells('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });

  it('finds nothing where there is no header and rule', () => {
    expect(tablesIn('No tables here.\n\n| just | one row |\n')).toEqual([]);
    expect(tablesIn('')).toEqual([]);
  });
});
