/**
 * 2 Nov, after Sean's 1 Nov recruitment plan: Go asked for "I approve this
 * plan" on Final plan while Check's i11 was still undecided, and the request
 * did not say so. The approval now names the finding, and a single one is
 * settled from the card before the approval.
 */
import { describe, expect, it } from 'vitest';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { initialState } from '@/lib/workflow/engine';
import type { StageEvaluation } from '@/lib/workflow/types';
import { describeNeed, needsUser, openRowsOf, type OpenRow } from './needs';

const stage = (id: string) => BOOK_V1.stages.find((s) => s.id === id)!;
const label = (id: string) => stage(id).short_label;
const unmet = [{ id: 'pos.differentiator', label: 'I approve this plan for use', satisfied: false, blocking: true, manual: true }];
const evaluation: StageEvaluation = { stageId: 'positioning', canAdvance: false, criteria: [], unmet };
const base = { state: initialState(BOOK_V1), policy: 'guided' as const, outlineStageId: 'outline', allowed: ['advance_stage'], stage: stage('positioning'), facts: {}, stageEvaluation: evaluation };
const i11: OpenRow = {
  stageId: 'check', stageLabel: 'Check', id: 'i11', severity: 'major',
  text: 'Drop the payment reserve and the criticism rule; tester payments stay at $0.',
};

describe('an approval asked while a finding is open elsewhere', () => {
  it('without open findings the approval is asked as before', () => {
    const need = needsUser(base)!;
    expect(need).toMatchObject({ kind: 'tick_criterion' });
    expect('openRows' in need).toBe(false);
    expect(describeNeed(need, label)).toMatchObject({ action: 'Approve and resume' });
    expect(describeNeed(need, label).options).toBeUndefined();
  });

  it('one open finding is named with its wording and decided first', () => {
    const need = needsUser({ ...base, openElsewhere: [i11] })!;
    expect(need).toMatchObject({ kind: 'tick_criterion', openRows: [i11] });
    const card = describeNeed(need, label);
    expect(card.message).toContain('Still undecided before you approve: i11 (Check) — “Drop the payment reserve');
    expect(card.message).toContain('Accepting i11 applies its suggested change and settles it on Check');
    expect(card.options?.map((o) => o.id)).toEqual(['accept_row', 'reject_row', 'resume']);
    expect(card.action).toBe('Accept i11 and carry on');
  });

  it('several open findings are all named; the approval stays the action', () => {
    const rows = [i11, { ...i11, id: 'i12', text: 'Second' }, { ...i11, id: 'i13', text: 'Third' }, { ...i11, id: 'i14', text: 'Fourth' }];
    const card = describeNeed(needsUser({ ...base, openElsewhere: rows })!, label);
    expect(card.message).toMatch(/i11 \(Check\).*i12 \(Check\).*i13 \(Check\).*\(\+1\)/);
    expect(card.options).toBeUndefined();
    expect(card.action).toBe('Approve and resume');
  });

  it('openRowsOf reads the rows off open-findings work only', () => {
    const template = { stages: [{ id: 'check', label: 'Check against requirements', short_label: 'Check' }] } as never;
    expect(openRowsOf(template, [
      { kind: 'open_findings', stageId: 'check', label: 'Check', count: 1, rows: [{ id: 'i11', text: i11.text, severity: 'major' }] },
      { kind: 'stale', stageId: 'x', label: 'X' },
    ] as never)).toEqual({ rows: [{ stageId: 'check', stageLabel: 'Check', id: 'i11', text: i11.text, severity: 'major' }] });
    expect(openRowsOf(template, [])).toEqual({});
  });
});
