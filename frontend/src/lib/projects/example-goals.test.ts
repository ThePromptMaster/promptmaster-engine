import { describe, expect, it } from 'vitest';
import { goalFromSearch } from './example-goals';

describe('a goal in the new-project URL', () => {
  it('comes through unchanged', () => {
    const goal = 'Write a one-page memo on moving from Slack to Teams. Budget $8,000/yr & 12 people.';
    expect(goalFromSearch(`?goal=${encodeURIComponent(goal)}`, 10_000)).toBe(goal);
  });

  it('reads nothing from a URL without a goal, and caps a long one', () => {
    expect(goalFromSearch('', 100)).toBe('');
    expect(goalFromSearch('?other=1', 100)).toBe('');
    expect(goalFromSearch(`?goal=${'x'.repeat(50)}`, 10)).toBe('x'.repeat(10));
  });
});
