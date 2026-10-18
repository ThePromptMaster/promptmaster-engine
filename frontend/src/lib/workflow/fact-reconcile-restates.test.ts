import { describe, expect, it } from 'vitest';
import type { ProjectFact } from '@/types/project';
import { factChangesFromRevision, withMeaningChanges } from './fact-reconcile';

/** 18 Oct, production pass (L-89): a correction was offered as a changed value and again as a new fact. */
const fact = (id: string, statement: string) =>
  ({ id, statement, subject: null, kind: 'fact', created_at: '2026-10-18T00:00:00Z', retired_at: null, superseded_by: null }) as unknown as ProjectFact;

const facts = [fact('f1', 'As of November 5, 2026, spending to date was reported as $18,000.')];
const instruction = 'Correction: spending to date on November 5, 2026 was $16,000, not $18,000. Testing will take 5 days.';
const before = 'Spending to date (as of November 5, 2026): $18,000.';
const after = 'Spending to date (as of November 5, 2026): $16,000. Testing will take 5 days.';

const offer = (additions: { statement: string; kind: 'fact' | 'requirement'; quote: string }[]) =>
  withMeaningChanges(factChangesFromRevision({ facts, instruction, before, after }), { facts, instruction, before, after }, async () => ({
    changes: [], additions,
  }));

describe('a correction is offered once', () => {
  it('drops a new fact that restates the changed value in other words', async () => {
    const out = await offer([{ statement: 'As of November 5, 2026, spending to date is $16,000.', kind: 'fact', quote: 'spending to date on November 5, 2026 was $16,000' }]);
    expect(out.map((c) => c.proposed)).toEqual(['As of November 5, 2026, spending to date was reported as $16,000.']);
  });

  it('keeps a genuine new fact beside the change', async () => {
    const out = await offer([{ statement: 'Testing will take 5 days.', kind: 'fact', quote: 'Testing will take 5 days.' }]);
    expect(out.map((c) => c.proposed)).toEqual(['As of November 5, 2026, spending to date was reported as $16,000.', 'Testing will take 5 days.']);
  });

  it('keeps a new fact that states a value of its own', async () => {
    const out = await offer([{ statement: 'As of November 7, 2026, spending to date is $16,000.', kind: 'fact', quote: 'spending to date on November 5, 2026 was $16,000' }]);
    expect(out).toHaveLength(2);
  });
});
