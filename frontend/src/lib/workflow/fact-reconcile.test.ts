import { describe, expect, it } from 'vitest';

import type { ProjectFact } from '@/types/project';
import { factValues } from './fact-values';
import { describeFactChange, factChangesFromRevision, revertsUserVersion } from './fact-reconcile';

const fact = (id: string, statement: string, kind: ProjectFact['kind'] = 'fact'): ProjectFact =>
  ({ id, statement, subject: null, kind, source_kind: 'chat', source_ref: {}, retired_at: null, supersedes: null, created_at: '2026-10-10T00:00:00Z' }) as unknown as ProjectFact;

const BEFORE = 'Hi team, join me for lunch on Thursday at 12:30 in the big room. Attendance is optional; bring your own lunch.';
const AFTER = 'Hi team, join me for lunch on Wednesday at 1:00 p.m. in the big room. Attendance is optional; bring your own lunch.';
const INSTRUCTION = 'Change it to Wednesday at 1:00 p.m., under 70 words, keep the warm tone, optional attendance and bring-your-own-lunch.';

describe('weekdays, times and length limits are values (10 Oct, Sean: lunch invitation)', () => {
  it('reads them however they are written', () => {
    expect(factValues('Thursday at 12:30').weekdays).toEqual(['thursday']);
    expect(factValues('Thursday at 12:30').times).toEqual(['12:30']);
    expect(factValues('1:00 p.m.').times).toEqual(['13:00']);
    expect(factValues('1 pm').times).toEqual(['13:00']);
    expect(factValues('Keep it under 120 words').limits).toEqual(['word:120']);
    expect(factValues('70 words or fewer').limits).toEqual(['word:70']);
    expect(factValues('a one-page plan').limits).toEqual(['page:1']);
  });

  it('a time or a limit is not also read as bare numbers', () => {
    expect(factValues('Thursday at 12:30, under 120 words').numbers).toEqual([]);
  });
});

describe('the facts a "Change it" revision changes', () => {
  const facts = [
    fact('a', 'The lunch is on Thursday at 12:30.'),
    fact('b', 'Invitation must be under 120 words.', 'requirement'),
    fact('c', 'Attendance is optional.'),
    fact('d', 'Budget is $200 for drinks.'),
  ];

  it('offers each fact whose value the revision replaced, with the user\'s words', () => {
    const out = factChangesFromRevision({ facts, instruction: INSTRUCTION, before: BEFORE, after: AFTER });
    expect(out.map((c) => c.fact.id)).toEqual(['a', 'b']);
    expect(out[0].proposed).toBe('The lunch is on Wednesday at 1:00 p.m.');
    expect(describeFactChange(out[0])).toBe('Thursday → Wednesday; 12:30 p.m. → 1:00 p.m.');
    expect(out[1].proposed).toBe('Invitation must be under 70 words.');
  });

  it('leaves a fact alone when the revision did not touch its value', () => {
    const out = factChangesFromRevision({ facts, instruction: 'Make it warmer.', before: BEFORE, after: BEFORE.replace('Hi team', 'Hello everyone') });
    expect(out).toEqual([]);
  });

  it('a value the old version never stated is not changed by a new one appearing', () => {
    const out = factChangesFromRevision({
      facts: [fact('d', 'Budget is $200 for drinks.')],
      instruction: 'Mention that parking costs $5.',
      before: BEFORE,
      after: `${BEFORE} Parking costs $5.`,
    });
    expect(out).toEqual([]);
  });

  it('a limit on another unit is not replaced', () => {
    const out = factChangesFromRevision({ facts: [fact('p', 'The plan fits on one page.', 'requirement')], instruction: 'Keep it under 300 words.', before: BEFORE, after: BEFORE });
    expect(out).toEqual([]);
  });

  it('a retired fact is not offered', () => {
    const retired = { ...fact('a', 'The lunch is on Thursday at 12:30.'), retired_at: '2026-10-10T01:00:00Z' } as ProjectFact;
    expect(factChangesFromRevision({ facts: [retired], instruction: INSTRUCTION, before: BEFORE, after: AFTER })).toEqual([]);
  });
});

describe('a revision that would undo the user\'s own version', () => {
  const facts = [fact('a', 'The lunch is on Thursday at 12:30.')];
  it('is found when it puts back what the stale fact says', () => {
    const out = revertsUserVersion({ facts, userText: AFTER, generated: BEFORE });
    expect(out.map((c) => `${c.was} → ${c.now}`)).toEqual(['Wednesday → Thursday', '1:00 p.m. → 12:30 p.m.']);
  });
  it('is not found when the revision keeps the user\'s values', () => {
    expect(revertsUserVersion({ facts, userText: AFTER, generated: AFTER.replace('Hi team', 'Hello all') })).toEqual([]);
  });
  it('a fact recorded after the user\'s version is their later word', () => {
    expect(revertsUserVersion({ facts, userText: AFTER, generated: BEFORE, userChosenAt: '2026-10-09T00:00:00Z' })).toEqual([]);
  });
  it('a value no fact states is not a reversal', () => {
    expect(revertsUserVersion({ facts: [], userText: AFTER, generated: BEFORE })).toEqual([]);
  });
});
