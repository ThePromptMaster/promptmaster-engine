/**
 * 1 Nov (Sean, "Tattoo Shop Second-Location Decision Memo"). After the memo
 * was written he narrowed the scope to B and C, replaced the $40,000 reserve
 * with $75,000, asked for the objective and requirements to be updated, and
 * for the memo to stay under 1,000 words. The requirements were recorded; the
 * stored objective and constraints kept A and $40,000; the chat reported
 * "Applied to the whole document — 1151 words" (the old length) and nothing
 * measured the limit; earlier stages sat "Awaiting recheck" while the main
 * button led back to "I approve this memo for use".
 */
import { describe, expect, it } from 'vitest';

import { appliedScopeLabel } from '@/components/workflow/chat-scope';
import { overtakenByChange, needStillHolds, type NeedsUser } from '@/lib/agent/needs';
import { factChangeGroup, withMeaningChanges } from './fact-reconcile';
import { measure, parseRequirements } from './measurable';
import type { WorkflowState } from './types';

describe('a word limit written with a thousands separator is measured', () => {
  it('reads "under 1,000 words" as at most 1000', () => {
    expect(parseRequirements(['Keep the memo under 1,000 words.'])).toEqual([expect.objectContaining({ kind: 'words', max: 1000 })]);
    expect(parseRequirements(['A decision memo of no more than 1\u00a0000 words'])).toEqual([expect.objectContaining({ kind: 'words', max: 1000 })]);
    expect(parseRequirements(['at most 2.000 words'])).toEqual([expect.objectContaining({ kind: 'words', max: 2000 })]);
  });

  it('a 1,151-word memo fails it', () => {
    const [r] = parseRequirements(['Keep the memo under 1,000 words.']);
    const m = measure(r, Array.from({ length: 1151 }, () => 'word').join(' '), true);
    expect(m?.satisfied).toBe(false);
  });

  it('a plain space still separates numbers', () => {
    expect(parseRequirements(['Three 100-word sections']).some((r) => r.max === 3100)).toBe(false);
    expect(parseRequirements(['3 100-word sections']).some((r) => r.max === 3100)).toBe(false);
  });
});

describe('the applied notice gives the revised length', () => {
  it('replaces the count the scope was chosen with', () => {
    expect(appliedScopeLabel('The whole document — 1151 words', 'one two three', 'document')).toBe('The whole document — 3 words now');
    expect(appliedScopeLabel('The selected text', 'one two', 'selection')).toBe('The selected text');
  });
});

describe('an instruction that replaces the objective is offered as a setup change', () => {
  const setup = { objective: 'Decide between A, B and C.', constraints: 'Minimum cash reserve $40,000.' };
  const check = async () => ({
    changes: [],
    additions: [],
    setup_changes: [
      { field: 'objective' as const, proposed: 'Decide between B and C.', quote: 'Compare expanded hours with keeping operations unchanged only.' },
      { field: 'constraints' as const, proposed: 'Minimum cash reserve $75,000.', quote: 'Replace the $40,000 reserve with $75,000.' },
    ],
  });

  it('first, as the project setup, with the field as it is now', async () => {
    const got = await withMeaningChanges([], { facts: [], instruction: 'Compare expanded hours with keeping operations unchanged only.', before: 'old', after: 'new', setup }, check);
    expect(got.map((c) => [c.setup, factChangeGroup(c), c.fact.statement, c.proposed])).toEqual([
      ['objective', 'setup', 'Decide between A, B and C.', 'Decide between B and C.'],
      ['constraints', 'setup', 'Minimum cash reserve $40,000.', 'Minimum cash reserve $75,000.'],
    ]);
  });

  it('never from an edit with no instruction', async () => {
    const got = await withMeaningChanges([], { facts: [], instruction: '', before: 'old', after: 'new', setup }, check);
    expect(got.filter((c) => c.setup)).toEqual([]);
  });
});

describe('a request asked before a change is overtaken by it', () => {
  const state = (since: string): WorkflowState =>
    ({ current_stage_id: 'memo', stages: { objective: { status: 'stale', stale: { reason: 'The scope changed.', since, was: 'complete' } }, memo: { status: 'in_progress' } } }) as unknown as WorkflowState;
  const approval: NeedsUser = { kind: 'tick_criterion', stageId: 'memo', criterionId: 'memo.approved', label: 'I approve this memo for use', onStage: 'memo', raisedAt: '2026-11-01T15:18:30Z' };

  it('the memo approval raised at 15:18 is overtaken by the 15:41 change', () => {
    expect(overtakenByChange(approval, state('2026-11-01T15:41:01Z'))).toBe(true);
    expect(needStillHolds(approval, { state: state('2026-11-01T15:41:01Z'), objective: 'x', currentStageId: 'memo' } as never)).toBe(false);
  });

  it('not by a stage that was already waiting when it was asked', () => {
    expect(overtakenByChange(approval, state('2026-11-01T15:00:00Z'))).toBe(false);
  });

  it('not without a time, nor a request about the recheck itself', () => {
    expect(overtakenByChange({ ...approval, raisedAt: undefined }, state('2026-11-01T15:41:01Z'))).toBe(false);
    expect(overtakenByChange({ kind: 'repair_stuck', stageId: 'objective', raisedAt: '2026-11-01T15:18:30Z' } as never, state('2026-11-01T15:41:01Z'))).toBe(false);
  });
});
