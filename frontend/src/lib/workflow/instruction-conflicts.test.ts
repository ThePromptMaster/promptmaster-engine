import { describe, expect, it } from 'vitest';

import { choiceLabels, directionsOf, gist, mergeConflicts, precedenceNote, ruleConflicts, type InstructionConflict } from './instruction-conflicts';
import { recommendedControl } from './precedence';

const base = { objective: 'An explainer for 10-year-olds', constraints: 'Under 300 words', decisions: [], others: [] };

describe('directionsOf', () => {
  it('reads one direction per axis', () => {
    expect(Object.fromEntries(directionsOf('Please expand this with more detail'))).toEqual({ length: 'longer' });
    expect(Object.fromEntries(directionsOf('Keep it short and simpler'))).toEqual({ length: 'shorter', depth: 'shallower' });
  });
  it('commits to nothing when a text says both ways', () => {
    expect(directionsOf('shorter overall, but expand the second point').has('length')).toBe(false);
  });
});

describe('ruleConflicts — instruction vs objective, constraints, decisions, other instructions', () => {
  it('catches an instruction against the constraints without a model call', () => {
    const [c] = ruleConflicts({ ...base, instruction: 'Expand it into a detailed chapter' });
    expect(c).toMatchObject({ kind: 'constraint', source: 'rule' });
    expect(c.explanation).toContain('length');
  });

  it('names every axis it pulls against, not just the first (a university rewrite of a 10-year-olds\' explainer)', () => {
    const found = ruleConflicts({
      ...base,
      objective: 'A one-page explainer for 10-year-olds, under 300 words',
      instruction: 'Rewrite it for university zoology students, expanded with much more detail',
    });
    expect(found[0].explanation).toBe('This instruction pulls the opposite way on length and depth from the objective.');
  });

  it('against the objective', () => {
    expect(ruleConflicts({ ...base, instruction: 'Make it more technical' })[0]).toMatchObject({ kind: 'objective' });
  });

  it('against a prior decision and another instruction, by id', () => {
    const found = ruleConflicts({
      ...base,
      constraints: '',
      objective: 'Giraffes',
      instruction: 'Use a more formal tone and broaden it',
      decisions: [{ id: 'd1', text: 'Keep the tone casual throughout' }],
      others: [{ id: 'r1', text: 'Focus only on the neck' }],
    });
    expect(found.map((c) => [c.kind, c.with_id])).toEqual([['decision', 'd1'], ['instruction', 'r1']]);
  });

  it('says nothing about instructions that fit', () => {
    expect(ruleConflicts({ ...base, instruction: 'Fix the typo in the second paragraph' })).toEqual([]);
  });
});

describe('merge and precedence', () => {
  const rule: InstructionConflict = { kind: 'constraint', with_id: '', with_text: 'Under 300 words', explanation: 'r', source: 'rule' };
  const model: InstructionConflict = { kind: 'constraint', with_id: '', with_text: 'the word limit', explanation: 'm', source: 'model' };
  const other: InstructionConflict = { kind: 'decision', with_id: 'd1', with_text: 'Natural selection only', explanation: 'm2', source: 'model' };

  it('keeps one entry per thing conflicted with, with every reason — the model\'s first', () => {
    const merged = mergeConflicts([rule], [model, other]);
    expect(merged.map((c) => c.explanation)).toEqual(['m r', 'm2']);
    expect(merged[0]).toMatchObject({ with_text: 'Under 300 words', source: 'rule' });
  });

  it('asks about the constraints once even when the model finds two clauses of them', () => {
    const second: InstructionConflict = { ...model, with_text: 'Use simple language', explanation: 'm3' };
    expect(mergeConflicts([], [model, second]).map((c) => c.explanation)).toEqual(['m m3']);
  });

  it('does not repeat a reason given twice, nor mutate its inputs', () => {
    const again: InstructionConflict = { ...model };
    expect(mergeConflicts([], [model, again]).map((c) => c.explanation)).toEqual(['m']);
    mergeConflicts([rule], [model]);
    expect(rule.explanation).toBe('r');
  });

  it('tells the model what the user decided, either way', () => {
    // Plain words, never a quote inside a quote (14 Oct, LANTERN).
    expect(precedenceNote(other, 'x', 'new')).toBe('The user has decided this instruction takes precedence over your earlier decision (Natural selection only).');
    expect(precedenceNote(rule, 'x', 'existing')).toContain('the constraints (Under 300 words) takes precedence');
  });
});


describe('one plain question that protects a recorded approval (14 Oct, Sean: LANTERN)', () => {
  const approval: InstructionConflict = {
    kind: 'fact', with_id: 'F2', source: 'model',
    with_text: 'Sponsor Elena approved a December 18, 2026 completion date. Only Elena can approve a change.',
    explanation: 'Elena hasn’t approved moving the date to January 15.',
    resolution: 'I’ll keep December 18 as the approved target and record Omar’s request as unapproved.',
    keep_label: 'Keep December 18 approved', override_label: 'Treat January 15 as approved', protects_approval: true,
  };
  const asOf: InstructionConflict = { kind: 'constraint', with_id: '', with_text: 'Use only the provided record as of November 10, 2026.', explanation: 'Outside the record.', source: 'model' };

  it('recommends keeping the approval, even against a newer instruction', () => {
    expect(recommendedControl('fact', true)).toBe('existing');
    expect(recommendedControl('fact')).toBe('existing');
    expect(recommendedControl('constraint')).toBe('new');
  });

  it('asks about the approval first', () => {
    expect(mergeConflicts([], [asOf, approval]).map((c) => c.with_id)).toEqual(['F2', '']);
  });

  it('labels the choices in a few words, with no quoted instruction', () => {
    expect(choiceLabels(approval)).toEqual({ keep: 'Keep December 18 approved', override: 'Treat January 15 as approved' });
    expect(choiceLabels({ ...approval, keep_label: '', override_label: '' })).toEqual({ keep: 'Keep the approved value', override: 'Override the recorded approval' });
    expect(choiceLabels(asOf)).toEqual({ keep: 'Keep the constraints', override: 'Follow the new instruction' });
  });

  it('tells the model to keep the approved value and record the request as unapproved', () => {
    const note = precedenceNote(approval, 'Change it to January 15', 'existing');
    expect(note).toContain('Keep what the record says is approved');
    expect(note).toContain('record Omar’s request as unapproved');
  });

  it('shortens an instruction at a sentence, never mid-word, with no quotes', () => {
    const update = '"Update LANTERN as of November 12. Luis confirms the final vacancy is filled. Actual spending is now $24,000. Everything else is unchanged."';
    expect(gist(update)).toBe('Update LANTERN as of November 12. Luis confirms the final vacancy is filled. Actual spending is now $24,000.');
    expect(gist('word '.repeat(60), 40).endsWith('word…')).toBe(true);
  });
});
