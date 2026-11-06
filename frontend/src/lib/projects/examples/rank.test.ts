import { describe, expect, it } from 'vitest';

import { EXAMPLE_CARDS } from './cards';
import { rankExamples } from './rank';

describe('rankExamples', () => {
  const catalog = EXAMPLE_CARDS.map((c) => c.key);

  it('is the catalog with no answers, or answers it does not know', () => {
    expect(rankExamples()).toEqual(catalog);
    expect(rankExamples('astronaut', 'nothing')).toEqual(catalog);
    expect(rankExamples('other')).toEqual(catalog);
  });

  it('leads with what fits the work and the need', () => {
    expect(rankExamples('investing', 'compare')[0]).toBe('deal_screening');
    expect(rankExamples('investing', 'memo')[0]).toBe('investment_memo');
    expect(rankExamples('consulting', 'slides')[0]).toBe('slide_deck');
    expect(rankExamples('finance', 'numbers')[0]).toBe('business_analysis');
  });

  it('always offers every example, never fewer', () => {
    expect([...rankExamples('research', 'memo')].sort()).toEqual([...catalog].sort());
  });
});
