import { describe, expect, it, vi } from 'vitest';

import type { ProjectFact } from '@/types/project';
import { factValues } from './fact-values';
import { applyChangesLabel, describeFactChange, factChangeGroup, factChangesFromRevision, revertsUserVersion, withMeaningChanges } from './fact-reconcile';

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

describe('a change of meaning, not a value (L-72, 11 Oct: in-office to fully remote)', () => {
  const facts = [fact('o', 'The team is five people, initially in-office.'), fact('a', 'The lunch is on Thursday at 12:30.')];
  const before = 'Day one happens at the office on Thursday at 12:30.';
  const after = 'Day one happens on video on Wednesday at 1:00 p.m. The team works fully remote.';
  it('asks only about the facts the value matcher did not offer, and adds what comes back', async () => {
    const values = factChangesFromRevision({ facts, instruction: 'Make it remote, Wednesday at 1:00 p.m.', before, after });
    const check = vi.fn(async (req: { facts: { id: string }[] }) => {
      expect(req.facts.map((f) => f.id)).toEqual(['o']);
      return { changes: [{ fact_id: 'o', proposed: 'The team is five people, fully remote.', quote: 'The team works fully remote.', why: 'now remote' }] };
    });
    const all = await withMeaningChanges(values, { facts, instruction: 'Make it remote, Wednesday at 1:00 p.m.', before, after }, check);
    expect(all.map((c) => [c.fact.id, c.proposed])).toEqual([
      ['a', 'The lunch is on Wednesday at 1:00 p.m.'],
      ['o', 'The team is five people, fully remote.'],
    ]);
    expect(describeFactChange(all[1])).toBe('now remote — “The team works fully remote.”');
  });
  it('a failed check leaves the value changes as they were', async () => {
    const values = factChangesFromRevision({ facts, instruction: 'x', before, after });
    expect(await withMeaningChanges(values, { facts, instruction: 'x', before, after }, async () => { throw new Error('down'); })).toEqual(values);
  });
});

describe('the facts review keeps changed values, new facts and requests apart (17 Oct, Sean, HARBOR)', () => {
  it('groups each change by kind and labels the button by count', async () => {
    const facts = [fact('f1', 'Lunch is Thursday at 12:30.')];
    const values = factChangesFromRevision({ facts, instruction: INSTRUCTION, before: BEFORE, after: AFTER });
    const check = vi.fn(async () => ({
      changes: [],
      additions: [
        { statement: 'Elena approved a November 24 launch.', kind: 'fact' as const, quote: 'Elena approved a November 24 launch' },
        { statement: 'Omar proposes moving testing to November 20.', kind: 'fact' as const, quote: 'Omar proposes moving testing to November 20', request: true },
      ],
    }));
    const all = await withMeaningChanges(values, { facts, instruction: 'Elena approved a November 24 launch. Omar proposes moving testing to November 20.', before: BEFORE, after: AFTER }, check);
    expect(all.map(factChangeGroup)).toEqual(['changed', 'new', 'request']);
    expect(applyChangesLabel(all.length)).toBe('Apply and record 3 changes');
    expect(applyChangesLabel(1)).toBe('Apply and record 1 change');
  });
});

describe('a replaced value takes the new value written in its place (18 Oct, production pass)', () => {
  const facts = [
    fact('d', 'As of November 6, 2026.'),
    fact('e', 'Sponsor Elena approved a November 20 launch and a $40,000 budget. Only Elena can approve date or budget changes.'),
  ];
  const before = '## Status Project TIDEWATER is approved for a November 20 launch. The approved budget is $40,000. ## Key facts As of November 6, 2026.';
  const after = '## Status Project TIDEWATER is approved for a November 24, 2026 launch. The approved budget is $44,000. ## Key facts As of November 7, 2026.';
  const instruction = 'Update as of November 7, 2026. Elena approved changing the launch to November 24, 2026 and increasing the approved budget to $44,000.';

  it('the launch moves to November 24, the report date to November 7', () => {
    const changes = factChangesFromRevision({ facts, instruction, before, after });
    expect(changes.map((c) => [c.fact.id, c.proposed])).toEqual([
      ['d', 'As of November 7, 2026.'],
      ['e', 'Sponsor Elena approved a November 24 launch and a $44,000 budget. Only Elena can approve date or budget changes.'],
    ]);
  });

  it('a new fact that repeats a changed value is offered once', async () => {
    const values = factChangesFromRevision({ facts, instruction, before, after });
    const all = await withMeaningChanges(values, { facts, instruction, before, after }, async () => ({
      changes: [],
      additions: [
        { statement: 'As of November 7, 2026.', kind: 'fact', quote: 'Update as of November 7, 2026.' },
        { statement: 'Elena approved changing the launch to November 24, 2026.', kind: 'fact', quote: 'Elena approved changing the launch to November 24, 2026' },
      ],
    }));
    expect(all.map((c) => c.proposed)).toEqual([
      'As of November 7, 2026.',
      'Sponsor Elena approved a November 24 launch and a $44,000 budget. Only Elena can approve date or budget changes.',
      'Elena approved changing the launch to November 24, 2026.',
    ]);
  });
});

describe('a recorded answer is matched on its answer only (18 Oct, pilot)', () => {
  it('a figure inside the question Go asked is not offered for change', () => {
    const facts = [fact('q', 'Decided by the user — asked "Should I add the remaining-budget calculation ($40,000 − $15,000 = $25,000) to the status summary?", answered: No, keep the pack as it is')];
    const before = 'Budget $40,000. Spent $15,000. Remaining $25,000.';
    const after = 'Budget $40,000. Spent $18,000. Remaining $22,000.';
    expect(factChangesFromRevision({ facts, instruction: 'Spending to date is $18,000.', before, after })).toEqual([]);
  });
});
