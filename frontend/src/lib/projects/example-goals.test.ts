import { describe, expect, it } from 'vitest';
import { EXAMPLE_GOALS, goalFromSearch, newProjectHref } from './example-goals';

describe('example goals', () => {
  it('round-trip through the new-project URL unchanged', () => {
    for (const { goal } of EXAMPLE_GOALS) {
      const href = newProjectHref(goal);
      expect(goalFromSearch(href.slice(href.indexOf('?')), 10_000)).toBe(goal);
    }
  });

  it('reads nothing from a URL without a goal, and caps a long one', () => {
    expect(goalFromSearch('', 100)).toBe('');
    expect(goalFromSearch('?other=1', 100)).toBe('');
    expect(goalFromSearch(`?goal=${'x'.repeat(50)}`, 10)).toBe('x'.repeat(10));
  });
});
