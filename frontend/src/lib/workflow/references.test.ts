import { describe, expect, it } from 'vitest';

import { referencePayload, referenceText, REFERENCE_MAX, REFERENCES_TOTAL_MAX, type ReferenceMaterial } from './references';
import { inputsFrom } from './stage-requests';
import { suppliedText } from './fact-boundary';
import type { Project } from '@/types/project';

const material = (over: Partial<ReferenceMaterial> = {}): ReferenceMaterial => ({
  referenceId: 'r1', projectId: 'p2', title: 'Harbor survey', objective: 'What customers want', deliverable: 'Final report',
  text: 'Customers want offline mode first.', facts: ['312 responses'], deleted: false, updatedAt: '', ...over,
});

describe('another project as a reference (client, 21 Oct, email 5)', () => {
  it('sends its deliverable and facts', () => {
    expect(referencePayload([material()])).toEqual([
      { title: 'Harbor survey', objective: 'What customers want', deliverable: 'Final report', excerpt: 'Customers want offline mode first.', facts: ['312 responses'] },
    ]);
  });

  it('caps each one, and shares the total evenly, saying where it cut', () => {
    const long = 'word '.repeat(10_000);
    const one = referencePayload([material({ text: long })]);
    expect(one[0].excerpt.length).toBeLessThanOrEqual(REFERENCE_MAX);
    expect(one[0].excerpt).toMatch(/omitted to fit/);

    const five = referencePayload(Array.from({ length: 5 }, (_, i) => material({ referenceId: `r${i}`, text: long })));
    const total = five.reduce((n, r) => n + r.excerpt.length, 0);
    expect(total).toBeLessThanOrEqual(REFERENCES_TOTAL_MAX);
    expect(five).toHaveLength(5);
  });

  it('leaves a project in the trash out of every prompt and every check', () => {
    expect(referencePayload([material({ deleted: true })])).toEqual([]);
    expect(referenceText([material({ deleted: true })])).toEqual([]);
  });

  it('rides in every request built from the project, and counts as what the user supplied', () => {
    const project = { objective: 'Launch plan', audience: '', constraints: '', output_format: '', mode: 'architect', references: [material()] } as unknown as Project;
    expect(inputsFrom(project).references?.[0].title).toBe('Harbor survey');
    expect(suppliedText(project)).toContain('Customers want offline mode first.');
    expect(inputsFrom({ ...project, references: [] }).references).toBeUndefined();
  });
});
