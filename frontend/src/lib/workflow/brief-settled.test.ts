/**
 * 4 Nov (Sean, support-software memo). The check's row f1 asked for the
 * headings the brief's Output format names, rated "major", and quoted that
 * Output format as what it carried out. Only accepted facts were matched, so
 * the quote named nothing, the row fell back to its severity and Go stopped
 * for a correction the brief had already settled. The brief's own
 * requirements now count as decided; the objective alone does not.
 */
import { describe, expect, it } from 'vitest';

import { itemSchemaFor, type StageItem } from './stage-artifact';
import { BOOK_V1 } from './templates/book.v1';
import {
  BRIEF_REASON,
  RECORDED_REASON,
  briefWords,
  decidedWords,
  findingRisk,
  quotedFact,
  recordedDecisions,
  splitUntriaged,
  withoutFieldLabel,
} from './triage';

const schema = itemSchemaFor(BOOK_V1.stages.find((s) => s.id === 'critique')!);

/** Project 543d1333 as saved (setup fields verbatim; the context abridged to the lines that matter). */
const project = {
  objective: 'Create a decision memo for choosing a customer-support software plan.',
  constraints:
    'Use only the supplied facts. Do not invent features, savings, implementation dates or approvals, and do not look up outside vendor information. Keep the memo under 500 words, including headings and tables.',
  output_format:
    'Decision memo with headings (Facts / Calculations / Assumptions / Comparison / Reserve Check / Recommendation / Missing Info & Next Steps), cost and reserve tables, under 500 words',
  context: [
    'Create a decision memo for choosing a customer-support software plan.',
    '',
    'Use only the supplied facts. Do not invent product features, savings, implementation dates or approvals.',
    '',
    'Option B:',
    '- $500 one-time setup fee.',
    '- The annual subscription payment is nonrefundable.',
    '',
    'Separate supplied facts, calculations and assumptions. Keep explanations about internal workflow outside the memo.',
  ].join('\n'),
  facts: [] as { statement: string; retired_at?: string | null }[],
};

/** Check v2, row f1, as saved at 17:06:17. */
const f1: StageItem = {
  id: 'f1',
  finding: 'The memo\'s headings do not match the required set. Its section 1 is "Decision required".',
  why_it_matters: 'Success test 2 and the output format require these headings.',
  suggested_change: 'Reorder and rename the sections as Facts / Calculations / Assumptions / Comparison / Reserve Check / Recommendation / Missing Info & Next Steps.',
  severity: 'major',
  implements:
    'Output format: Decision memo with headings (Facts / Calculations / Assumptions / Comparison / Reserve Check / Recommendation / Missing Info & Next Steps), cost and reserve tables, under 500 words',
};

describe('a correction the brief settles is decided, whatever its severity', () => {
  it('reads the field name off a quote', () => {
    expect(withoutFieldLabel('Output format: Decision memo')).toBe('Decision memo');
    expect(withoutFieldLabel('Constraints — Keep the memo short')).toBe('Keep the memo short');
    expect(withoutFieldLabel('Decision memo')).toBe('Decision memo');
  });

  it('takes the constraints and output format whole and the request a line at a time, never the objective', () => {
    const words = briefWords(project);
    expect(words.find((w) => w.source === 'Output format')?.statement).toBe(project.output_format);
    expect(words.find((w) => w.source === 'Constraints')?.statement).toBe(project.constraints);
    const request = words.filter((w) => w.source === 'Your request').map((w) => w.statement);
    expect(request).toContain('The annual subscription payment is nonrefundable.');
    expect(request).toContain('$500 one-time setup fee.');
    // The objective, and the request's line that only restates it, decide nothing.
    expect(request.some((l) => l.startsWith('Create a decision memo'))).toBe(false);
    // Too short to be a requirement.
    expect(request).not.toContain('Option B:');
  });

  it('f1 quotes the Output format, so it is routine although major', () => {
    expect(findingRisk(f1, schema, decidedWords(project))).toBe('routine');
    // Before 4 Nov only facts were read, and it was the user's.
    expect(findingRisk(f1, schema, decidedWords({ ...project, output_format: '' }))).toBe('material');
  });

  it('accepts f1 in code, naming the field and the words', () => {
    const [d] = recordedDecisions([f1], schema, decidedWords(project));
    expect(d.id).toBe('f1');
    expect(d.status).toBe('accepted');
    expect(d.reason!.startsWith(`${BRIEF_REASON} Output format: "Decision memo with headings (Facts`)).toBe(true);
  });

  it('a quote of the objective alone is not a decision', () => {
    const big: StageItem = { ...f1, id: 'f9', implements: 'Create a decision memo for choosing a customer-support software plan.' };
    expect(findingRisk(big, schema, decidedWords(project))).toBe('material');
    expect(recordedDecisions([big], schema, decidedWords(project))).toEqual([]);
  });

  it('a quote the brief does not contain names nothing', () => {
    const made: StageItem = { ...f1, id: 'f8', implements: 'Output format: a one-page memo with five numbered headings' };
    expect(quotedFact(made.implements, decidedWords(project))).toBeNull();
    expect(findingRisk(made, schema, decidedWords(project))).toBe('material');
  });

  it('a row that would alter a brief requirement stays the user\'s, whatever its severity', () => {
    const loosen: StageItem = {
      id: 'f7', finding: 'Too tight.', suggested_change: 'Allow 650 words.', severity: 'minor',
      changes: 'Keep the memo under 500 words, including headings and tables.',
    };
    expect(findingRisk(loosen, schema, decidedWords(project))).toBe('material');
    const { routine, material } = splitUntriaged([loosen, f1], schema, decidedWords(project));
    expect(routine.map((r) => r.id)).toEqual(['f1']);
    expect(material.map((r) => r.id)).toEqual(['f7']);
  });

  it('a fact wins over the brief, and retired facts are not read', () => {
    const withFact = { ...project, facts: [{ statement: 'The annual subscription payment is nonrefundable.' }, { statement: 'Old figure is $400 for the reserve.', retired_at: '2026-11-02' }] };
    const row: StageItem = { id: 'f2', finding: 'x', suggested_change: 'y', severity: 'major', implements: 'The annual subscription payment is nonrefundable.' };
    expect(recordedDecisions([row], schema, decidedWords(withFact))[0].reason).toBe(`${RECORDED_REASON} "The annual subscription payment is nonrefundable."`);
    const retired: StageItem = { ...row, id: 'f3', implements: 'Old figure is $400 for the reserve.' };
    expect(quotedFact(retired.implements, decidedWords(withFact))).toBeNull();
  });
});
