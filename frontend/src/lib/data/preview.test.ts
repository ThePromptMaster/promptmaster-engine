import { describe, expect, it } from 'vitest';

import { describePreview, previewOf, rejectReason, splitLine } from './preview';

describe('previewOf: what a model is shown of an attached file', () => {
  it('reads a CSV header, the first rows and the row count', () => {
    const csv = 'account_id,plan,churned\nA1,"Mid, Market",1\nA2,Enterprise,0\n\nA3,Mid-Market,1\n';
    const p = previewOf('accounts.csv', csv);
    expect(p).toEqual({
      kind: 'table', columns: ['account_id', 'plan', 'churned'], rows: 3,
      sample: [['A1', 'Mid, Market', '1'], ['A2', 'Enterprise', '0'], ['A3', 'Mid-Market', '1']],
    });
    expect(describePreview(p)).toBe('3 rows · account_id, plan, churned');
  });

  it('reads TSV, a JSON array of objects, and plain text', () => {
    expect(previewOf('t.tsv', 'a\tb\n1\t2')).toMatchObject({ columns: ['a', 'b'], rows: 1 });
    expect(previewOf('r.json', '[{"id":1,"x":"y"},{"id":2,"x":"z"}]')).toEqual({ kind: 'json', columns: ['id', 'x'], sample: [['1', 'y'], ['2', 'z']], rows: 2 });
    expect(previewOf('notes.txt', 'one\ntwo')).toMatchObject({ kind: 'text', rows: 2 });
    expect(previewOf('bad.json', '{nope')).toMatchObject({ kind: 'text' });
  });

  it('keeps a quoted quote, and never shows more than five rows', () => {
    expect(splitLine('a,"say ""hi""",c', ',')).toEqual(['a', 'say "hi"', 'c']);
    const many = ['h', ...Array.from({ length: 40 }, (_, i) => String(i))].join('\n');
    const p = previewOf('m.csv', many);
    expect(p.sample).toHaveLength(5);
    expect(p.rows).toBe(40);
  });
});

describe('rejectReason', () => {
  it('says why a file cannot be attached', () => {
    expect(rejectReason('book.pdf', 10, [])).toMatch(/not a spreadsheet \(\.xlsx\), CSV, TSV, JSON or text file/);
    expect(rejectReason('big.csv', 6_000_000, [])).toMatch(/larger than 5 MB/);
    expect(rejectReason('a.csv', 10, ['a.csv'])).toMatch(/already attached/);
    expect(rejectReason('a.csv', 0, [])).toMatch(/empty/);
    expect(rejectReason('a.csv', 10, [])).toBeNull();
  });
});
