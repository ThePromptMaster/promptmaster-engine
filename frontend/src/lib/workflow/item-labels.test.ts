import { describe, expect, it } from 'vitest';

import { aboutAnotherItem, itemLabels } from './item-labels';

describe('item labels (L-270)', () => {
  it('reads labelled items, plural lists and possessives', () => {
    expect([...(itemLabels('The Option B vendor').get('option') ?? [])]).toEqual(['B']);
    expect([...(itemLabels("Option B's training").get('option') ?? [])]).toEqual(['B']);
    expect([...(itemLabels('Options A and C miss the deadline').get('option') ?? [])]).toEqual(['A', 'C']);
    expect([...(itemLabels('Site 3 and Phase II').keys())]).toEqual(['site', 'phase']);
  });

  it('a date or a weekday is not an item', () => {
    expect(itemLabels('live by December 18, Friday 9 a.m.').size).toBe(0);
  });

  it('a word followed by more letters is not an item ("Option Board")', () => {
    expect(itemLabels('the Option Board met').size).toBe(0);
  });

  it('a sentence about Option B is not about Option A or C, but is about Option B', () => {
    const s = 'The Option B vendor has corrected the training charge from $6,000 to $7,500.';
    expect(aboutAnotherItem(s, 'Option A: one vendor; $47,000 + $6,000 training')).toBe(true);
    expect(aboutAnotherItem(s, 'Option B: two vendors; $49,000 + $6,000 training')).toBe(false);
    expect(aboutAnotherItem(s, 'Requirement: Hard $60,000 all-in budget')).toBe(false);
    expect(aboutAnotherItem(s, 'Each option includes a $6,000 training charge.')).toBe(true);
    expect(aboutAnotherItem('All options now include $7,500 training.', 'Option A: $6,000 training')).toBe(false);
    expect(aboutAnotherItem('Options A and B now include $7,500 training.', 'Option A: $6,000 training')).toBe(false);
  });
});
