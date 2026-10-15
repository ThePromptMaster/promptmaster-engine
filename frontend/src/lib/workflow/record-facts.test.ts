import { describe, expect, it } from 'vitest';

import { factsAlreadyRecorded, normStatement, planFactRecording } from './record-facts';
import type { ProjectFact } from '@/types/project';
import type { ReplyAction } from '@/types';

const fact = (id: string, statement: string, extra: Partial<ProjectFact> = {}): ProjectFact =>
  ({ id, statement, subject: null, kind: 'fact', source_kind: 'chat', source_ref: {}, retired_at: null, supersedes: null, created_at: '2026-10-14T00:00:00Z', ...extra }) as ProjectFact;

const action = (...facts: NonNullable<ReplyAction['facts']>): ReplyAction => ({ label: 'Record these facts', kind: 'record_facts', facts });

describe('recording side-chat facts once (Sean, 14 Oct, SUMMIT)', () => {
  it('reads punctuation, case and spacing as the same statement', () => {
    expect(normStatement('Actual spending:  $25,000.')).toBe(normStatement('actual spending $25 000'));
  });

  it('inserts only what is not on record', () => {
    const plan = planFactRecording(
      [{ statement: 'Reconciliation finished November 17, 2026.' }, { statement: 'Actual spending is $25,000.' }],
      [fact('a', 'reconciliation finished November 17, 2026')]
    );
    expect(plan.insert.map((f) => f.statement)).toEqual(['Actual spending is $25,000.']);
    expect(plan.already).toBe(1);
  });

  it('a second click records nothing: the action now reads as done', () => {
    const a = action({ statement: 'Actual spending is $25,000.' }, { statement: 'SUMMIT-001 is complete.' });
    const after = [fact('x', 'Actual spending is $25,000.'), fact('y', 'SUMMIT-001 is complete.')];
    expect(factsAlreadyRecorded(a, after)).toBe(true);
    expect(planFactRecording(a.facts!, after).insert).toEqual([]);
    expect(factsAlreadyRecorded(a, after.slice(0, 1))).toBe(false);
  });

  it('a retired fact does not count as recorded', () => {
    const a = action({ statement: 'Actual spending is $25,000.' });
    expect(factsAlreadyRecorded(a, [fact('x', 'Actual spending is $25,000.', { retired_at: '2026-10-14T01:00:00Z' })])).toBe(false);
  });

  it('a new value for a fact on record supersedes it, once', () => {
    const old = fact('s', 'Actual spending: $23,000.');
    const plan = planFactRecording(
      [{ statement: 'Actual spending is $25,000.', replaces: 'Actual spending: $23,000.' }, { statement: 'Spend is $25k', replaces: 'Actual spending: $23,000.' }],
      [old]
    );
    expect(plan.supersede).toEqual([{ old, fact: { statement: 'Actual spending is $25,000.', replaces: 'Actual spending: $23,000.' } }]);
    expect(plan.insert.map((f) => f.statement)).toEqual(['Spend is $25k']);
  });
});
