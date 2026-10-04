import { describe, expect, it } from 'vitest';

import { applyLookup, enoughWorksFound, lookupQueries, lookupSummary, rowsFromSearch, type WorkMatch } from './lookup';
import { RESEARCH_V1 } from './templates/research.v1';
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
    const text = lookupSummary({ items: [], found: 5, notFound: 1, unreachable: 0 }, 'works');
    expect(text).toContain('5 of 6 works found in OpenAlex.');
    expect(text).toContain('1 not found — it may be misremembered, or not exist.');
    expect(text).toContain('means the work exists, not that it says what the row claims');
  });
});

describe('a claim\'s named source can be looked up; finding it is not verifying the claim', () => {
  const claims = ITEM_SCHEMAS.claim_table;
  const rows = [
    { id: 'a', claim: 'Retention offers can backfire', source: 'Ascarza (2018), Retention Futility', status: 'candidate_source' },
    { id: 'b', claim: 'Churn doubled', source: 'the author\'s own data', status: 'candidate_source' },
    // Decided before sources were recorded: only the user could have.
    { id: 'c', claim: 'Switching has eight causes', source: 'Keaveney 1995', status: 'verified' },
    { id: 'd', claim: 'Nobody knows', source: '', status: 'no_source' },
  ];

  it('a found source moves the row to "source found" — still undecided — with the record and DOI', async () => {
    const { isTriaged } = await import('./stage-artifact');
    const r = applyLookup(rows, [match('a'), match('b', { found: false, note: 'No record with this title was found.' }), match('c')], claims);
    expect(r.items[0]).toMatchObject({ status: 'source_found', status_source: 'tool', link: 'https://doi.org/10.1509/jmr.16.0163', record: 'Retention Futility — Eva Ascarza (2018)' });
    expect(isTriaged(r.items[0], claims)).toBe(false);
    // Not found: left exactly as it was.
    expect(r.items[1]).toBe(rows[1]);
    // The user's own verification stands; the record is added beside it.
    expect(r.items[2]).toMatchObject({ status: 'verified', record: 'Retention Futility — Eva Ascarza (2018)' });
    expect(r.items[2].status_source).toBeUndefined();
    expect(lookupSummary(r, claims.lookup!.noun)).toContain('2 of 3 sources found in OpenAlex.');
  });

  it('is never offered in the status dropdown, and "verified by PromptMaster" is still nobody\'s to set', () => {
    const byValue = Object.fromEntries(claims.statuses!.map((s) => [s.value, s]));
    expect(byValue.source_found).toMatchObject({ settable: false, decided: false });
    expect(byValue.verified_by_promptmaster.settable).toBe(false);
    expect(byValue.source_found.modelMaySet).toBeUndefined();
  });
});

describe('what is worth searching for (production pass, 2026-10-01)', () => {
  const claims = ITEM_SCHEMAS.claim_table;

  it('a claim with no source found, or a source cell that names nothing, is not searched', () => {
    const rows = [
      { id: 'a', claim: 'x', source: 'Cornell Cooperative Extension, basil growing guides', status: 'candidate_source' },
      { id: 'b', claim: 'x', source: 'none found', status: 'no_source' },
      { id: 'c', claim: 'x', source: 'None', status: 'candidate_source' },
      { id: 'd', claim: 'x', source: 'n/a', status: 'candidate_source' },
      { id: 'e', claim: 'x', source: '', status: 'candidate_source' },
      { id: 'f', claim: 'x', source: 'A real title that happens to be filed under no source found', status: 'no_source' },
      { id: 'g', claim: 'x', source: 'None of the Above: a study of ballots', status: 'candidate_source' },
    ];
    expect(lookupQueries(rows, claims).map((q) => q.id)).toEqual(['a', 'g']);
    // Works have no such status: every named one is searched, up to the cap.
    expect(lookupQueries(rows, lit)).toEqual([]);
    const works = Array.from({ length: 30 }, (_, i) => ({ id: `w${i}`, work: `Work ${i}` }));
    expect(lookupQueries(works, lit)).toHaveLength(20);
  });

  it('a source that is not found is not called misremembered: most are simply not research papers', () => {
    const text = lookupSummary({ items: [], found: 0, notFound: 16, unreachable: 0 }, claims.lookup!.noun, claims.lookup!.notFoundNote);
    expect(text).toContain('0 of 16 sources found in OpenAlex.');
    expect(text).toContain('16 not found. The index holds published research; a guide, a website or the author\'s own data will not be in it');
    expect(text).not.toContain('may be misremembered, or not exist');
  });
});

describe('rowsFromSearch (2 Oct: no works are listed yet)', () => {
  const found = [
    match('W1', { title: 'Retention Futility: Targeting High-Risk Customers Might be Ineffective' }),
    match('W2', { title: 'Customer switching behavior in service industries', authors: 'Susan Keaveney', year: 1995, doi: 'https://doi.org/10.2307/1252074' }),
  ];

  it('a returned record becomes a Retrieved row naming the work, with its DOI, and claims nothing about what it says', () => {
    const [row] = rowsFromSearch(found, [], lit);
    expect(row).toMatchObject({
      work: 'Eva Ascarza (2018). Retention Futility: Targeting High-Risk Customers Might be Ineffective',
      link: 'https://doi.org/10.1509/jmr.16.0163',
      record: 'Retention Futility: Targeting High-Risk Customers Might be Ineffective — Eva Ascarza (2018)',
      status: 'retrieved', status_source: 'tool', finding: '', relation: '',
    });
    expect(row.id).toBeTruthy();
  });

  it('does not add a work already on the list, by DOI or by title', () => {
    const existing = [
      { id: 'a', work: 'Ascarza (2018), "Retention Futility: Targeting High-Risk Customers Might Be Ineffective"', status: 'candidate' },
      { id: 'b', work: 'Keaveney', link: 'https://doi.org/10.2307/1252074', status: 'verified', status_source: 'user' },
    ];
    expect(rowsFromSearch(found, existing, lit)).toEqual([]);
    expect(rowsFromSearch([found[0], found[0]], [], lit)).toHaveLength(1);
  });

  it('never grows the list past what the stage holds', () => {
    const full = Array.from({ length: lit.maxItems - 1 }, (_, n) => ({ id: `r${n}`, work: `Some other work number ${n}` }));
    expect(rowsFromSearch(found, full, lit)).toHaveLength(1);
  });

  it('adds nothing to a table whose rows are not works', () => {
    expect(rowsFromSearch(found, [], ITEM_SCHEMAS.claim_table)).toEqual([]);
    expect(rowsFromSearch(found, [], ITEM_SCHEMAS.hypotheses)).toEqual([]);
  });
});

describe('enoughWorksFound: no more topic searches once the stage has its works (4 Oct)', () => {
  const stage = RESEARCH_V1.stages.find((s) => s.id === 'literature')!;
  const row = (status: string) => ({ id: status + Math.random(), work: 'A work', status });

  it('is met by the stage\'s own "at least three retrieved or verified"', () => {
    expect(enoughWorksFound(stage, [row('retrieved'), row('verified'), row('retrieved')], lit)).toBe(true);
  });

  it('is not met by candidates the model suggested, or by too few found', () => {
    expect(enoughWorksFound(stage, [row('candidate'), row('candidate'), row('candidate'), row('retrieved')], lit)).toBe(false);
    expect(enoughWorksFound(stage, [row('retrieved'), row('verified')], lit)).toBe(false);
  });

  it('says nothing for a stage without such a requirement', () => {
    const question = RESEARCH_V1.stages.find((s) => s.id === 'question')!;
    expect(enoughWorksFound(question, [row('retrieved'), row('retrieved'), row('retrieved')], lit)).toBe(false);
  });
});
