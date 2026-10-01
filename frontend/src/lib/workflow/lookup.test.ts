import { describe, expect, it } from 'vitest';

import { applyLookup, lookupSummary, type WorkMatch } from './lookup';
import { ITEM_SCHEMAS } from './stage-artifact';

const lit = ITEM_SCHEMAS.literature_map;
const match = (id: string, over: Partial<WorkMatch> = {}): WorkMatch => ({
  id, found: true, title: 'Retention Futility', authors: 'Eva Ascarza', year: 2018, doi: 'https://doi.org/10.1509/jmr.16.0163', url: '', note: '', ...over,
});

describe('applyLookup (1 Oct, item 12)', () => {
  const rows = [
    { id: 'a', work: 'Ascarza 2018', finding: 'x', relation: 'y', status: 'candidate', status_source: 'model' },
    { id: 'b', work: 'Invented 2021', finding: 'x', relation: 'y', status: 'candidate', status_source: 'model' },
    { id: 'c', work: 'Keaveney 1995', finding: 'x', relation: 'y', status: 'verified', status_source: 'user', link: 'my-own-link' },
  ];

  it('a found work becomes Retrieved, with its DOI and the record that was found', () => {
    const r = applyLookup(rows, [match('a'), match('b', { found: false, note: 'No record with this title was found.' }), match('c')], lit);
    expect(r.items[0]).toMatchObject({ status: 'retrieved', status_source: 'tool', link: 'https://doi.org/10.1509/jmr.16.0163', record: 'Retention Futility — Eva Ascarza (2018)' });
    expect(r).toMatchObject({ found: 2, notFound: 1, unreachable: 0 });
  });

  it('a work that was not found stays a candidate', () => {
    const r = applyLookup(rows, [match('b', { found: false, note: 'No record with this title was found.' })], lit);
    expect(r.items[1]).toBe(rows[1]);
  });

  it('never downgrades what the user verified, nor overwrites their link', () => {
    const r = applyLookup(rows, [match('c')], lit);
    expect(r.items[2]).toMatchObject({ status: 'verified', status_source: 'user', link: 'my-own-link', record: 'Retention Futility — Eva Ascarza (2018)' });
  });

  it('says what a found record does and does not mean', () => {
    const text = lookupSummary({ items: [], found: 5, notFound: 1, unreachable: 0 }, 'work');
    expect(text).toContain('5 of 6 works found in OpenAlex.');
    expect(text).toContain('1 not found — it may be misremembered, or not exist.');
    expect(text).toContain('means the work exists, not that it says what the row claims');
  });
});
