import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from './templates/book.v1';
import { QUICK_V1 } from './templates/quick.v1';
import { checkIssues, hasFinalCheckOfItsOwn, repairInstruction, repairSummary, wantsFinalCheck } from './final-check';

describe('the final check on a one-stage draft (11 Nov)', () => {
  it('is decided by the workflow having one written stage, not by its key', () => {
    expect(hasFinalCheckOfItsOwn(QUICK_V1)).toBe(true);
    expect(hasFinalCheckOfItsOwn({ ...QUICK_V1, key: 'custom_abc' } as never)).toBe(true);
    expect(hasFinalCheckOfItsOwn(BOOK_V1)).toBe(false);
  });

  const draft = { id: 'v1', content: 'A memo.', source_operation: 'stage_draft', finish_reason: 'stop' };
  it('reads a draft the model wrote, once', () => {
    expect(wantsFinalCheck(draft, new Set())).toBe(true);
    expect(wantsFinalCheck(draft, new Set(['v1']))).toBe(false);
  });
  it('leaves alone what the user edited or asked for, a cut-off draft, and its own correction', () => {
    expect(wantsFinalCheck({ ...draft, source_operation: 'stage_edit' }, new Set())).toBe(false);
    expect(wantsFinalCheck({ ...draft, source_operation: 'chat_instruct' }, new Set())).toBe(false);
    expect(wantsFinalCheck({ ...draft, source_operation: 'applied_findings' }, new Set())).toBe(false);
    expect(wantsFinalCheck({ ...draft, finish_reason: 'length' }, new Set())).toBe(false);
    expect(wantsFinalCheck({ ...draft, content: '  ' }, new Set())).toBe(false);
    expect(wantsFinalCheck(null, new Set())).toBe(false);
  });

  const found = {
    contradictions: [
      { rule_quote: 'Margin failure: conditional.', conflicts_quote: '', problem: 'It doubts a supplied fact.', fix: 'State the failure as it stands.' },
      { rule_quote: '', conflicts_quote: '', problem: '  ', fix: '' },
    ],
  };
  it('turns what the check found into one line each, and tells the correction to change nothing else', () => {
    const issues = checkIssues(found);
    expect(issues).toEqual(['It doubts a supplied fact. Passage: "Margin failure: conditional.". Fix: State the failure as it stands.']);
    expect(repairInstruction(issues)).toContain('change nothing else');
    expect(repairInstruction(issues)).toContain('- It doubts a supplied fact.');
    expect(repairSummary(issues).startsWith('Final check: corrected 1 point — ')).toBe(true);
    expect(repairSummary(Array(40).fill('A long issue line that repeats.')).length).toBeLessThanOrEqual(1000);
  });
});
