import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { approvedComparisons, comparisonLine, sectionUnder, sectionsNamed } from './approved-sections';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'workflow', '__fixtures__', name), 'utf8');

// 27 Nov (Sean, Northline Fixtures; L-329): "Final review couldn't compare v4's
// outreach wording against approved Output v2 … I compared the rendered message
// text and it matched exactly." His saved Output v2 and v4 and the D5 fact.
const v2 = fixture('northline-output-v2.md');
const v4 = fixture('northline-output-v4.md');
const d5 = fixture('northline-d5.txt');
const template = { stages: [{ id: 'input', label: 'Input', short_label: 'Input' }, { id: 'output', label: 'Output', short_label: 'Output' }] } as never;
const bundles = { output: { versions: [{ id: 'o1', version_number: 1, content: 'v1' }, { id: 'o2', version_number: 2, content: v2 }, { id: 'o3', version_number: 3, content: v2 }, { id: 'o4', version_number: 4, content: v4 }] } };

describe('the section an approval names, compared with the version it names (L-329)', () => {
  it('reads the section under its heading, to the next heading of its level', () => {
    const outreach = sectionUnder(v2, 'OUTREACH')!;
    expect(outreach.split('\n')[0]).toBe('## OUTREACH — Candidate outreach draft');
    expect(outreach).toContain('Dear [Candidate name],');
    expect(outreach).not.toContain('## Decision and approval log');
    expect(sectionsNamed(v2, d5)).toEqual(expect.arrayContaining(['OUTREACH', 'BRIEF', 'SCREEN']));
  });

  it('only what a sentence approves: "BRIEF and SCREEN in Output v2 remain unapproved" compares nothing', () => {
    expect(approvedComparisons(template, bundles, v4, { id: 'o4', version_number: 4 }, [d5]).map((c) => `${c.section} v${c.version}`)).toEqual(['OUTREACH v2']);
  });

  it("Sean's v4 OUTREACH is v2's word for word, its internal header aside", () => {
    const found = approvedComparisons(template, bundles, v4, { id: 'o4', version_number: 4 }, [d5]);
    const outreach = found.find((c) => c.section === 'OUTREACH')!;
    expect(outreach).toMatchObject({ stage: 'Output', version: 2, current: 4, identical: true });
    expect(outreach.notesAside.join(' ')).toMatch(/Internal header/);
    expect(comparisonLine(outreach, 'Output')).toBe('OUTREACH in Output v4 compared in code with Output v2, the version an approval names — identical word for word, apart from its internal note lines');
  });

  it('a changed word is named, with both versions', () => {
    const edited = v4.replace('The role reports directly to the CEO, Jordan Lee.', 'The role reports to the CEO.');
    const outreach = approvedComparisons(template, bundles, edited, { id: 'o5', version_number: 5 }, [d5]).find((c) => c.section === 'OUTREACH')!;
    expect(outreach.identical).toBe(false);
    expect(outreach.differences).toEqual(['v2: I am writing about the role of VP Operations at Northline Fixtures, a manufacturer. The role reports directly to the CEO, Jordan Lee.', 'v5: I am writing about the role of VP Operations at Northline Fixtures, a manufacturer. The role reports to the CEO.']);
    expect(comparisonLine(outreach, 'Output')).toMatch(/— differs: v2: I am writing/);
  });

  it('a statement naming no version, or a version that is the one judged, compares nothing', () => {
    expect(approvedComparisons(template, bundles, v4, { id: 'o4', version_number: 4 }, ['Elise approved the OUTREACH wording.'])).toEqual([]);
    expect(approvedComparisons(template, bundles, v4, { id: 'o4', version_number: 4 }, ['OUTREACH as it appears in Output v4.'])).toEqual([]);
    expect(approvedComparisons(template, bundles, v4, { id: 'o4', version_number: 4 }, ['OUTREACH as it appears in Output v9.'])).toEqual([]);
  });

  it('a section gone from the text judged is a difference', () => {
    const gone = v4.replace(sectionUnder(v4, 'OUTREACH')!, '');
    expect(approvedComparisons(template, bundles, gone, { id: 'o5', version_number: 5 }, [d5]).find((c) => c.section === 'OUTREACH')).toMatchObject({ identical: false, differences: ['v5: no section named OUTREACH'] });
  });
});
