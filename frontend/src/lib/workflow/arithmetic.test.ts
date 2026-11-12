import { describe, expect, it } from 'vitest';

import { arithmeticSlips } from './arithmetic';

describe('sums recomputed from the text (8 Nov)', () => {
  it('passes the working from the real package', () => {
    for (const fine of [
      '| Training, 8 sessions × $1,000 | 8 × $1,000 = **$8,000** | Conditional booking |',
      '| **Committed** | $43,000 + $8,000 = **$51,000** | |',
      '| Committed | $43,000 fixed + $8,000 training = **$51,000** | |',
      '$60,000 − $46,000 = $14,000 remaining',
      '$10,000 + $20,000 + $8,000 + $8,000 = $46,000',
      '100 / 4 = 25',
      '8 x $1,000 = $8,000',
    ]) expect(arithmeticSlips(fine), fine).toEqual([]);
  });

  it('finds working that does not come to its result', () => {
    expect(arithmeticSlips('| Total | $37,000 + $8,000 = **$46,000** |')[0]).toContain('works out to 45,000, not 46,000');
    expect(arithmeticSlips('Spend: 8 × $1,000 = $9,000')).toHaveLength(1);
    expect(arithmeticSlips('$60,000 − $46,000 = $13,000')).toHaveLength(1);
  });

  it('reads each sum on a line', () => {
    expect(arithmeticSlips('Left: $1,200 − $800 = $400; then $400 − $300 = $200')).toHaveLength(1);
  });

  it('leaves alone what it cannot read as a plain sum', () => {
    for (const fine of [
      'Price = $40',
      'North 4/4/4/4/4/4/3/3 = 30',
      'Rate is 5% = $50',
      '2 + 3 × 4 = 14',
      'Week 5-6 = migration',
      'Dated 2026-11-08 = today',
      'p < 0.05 = significant',
      'The ratio (a + b) = 3',
    ]) expect(arithmeticSlips(fine), fine).toEqual([]);
  });

  it('reads a scale said after a figure as part of it (12 Nov)', () => {
    for (const fine of [
      // The line a facts register carried: read as 3.5 − 600,000 it "worked out to -599,996.5, not 2.9".
      '"claim": "Calculation: Adjusted EBITDA and margin | Category: financials | Value: $3.5 million − $600,000 = $2.9 million; $2.9 million ÷ $18 million ≈ 16.1% vs the 15% floor",',
      '$3.5 million − $600,000 = $2.9 million',
      // The same sum as two other stages of that run wrote it.
      '- Reasoned: adjusted EBITDA = $3.5 million reported − $600,000 insurance recovery = **$2.9 million**.',
      '| B | Adjusted EBITDA margin | $3.5 million − $600,000 = $2.9 million; $2.9 million ÷ $18 million ≈ 16.1% vs at least 15% | Pass |',
      '$3.5m − $0.6m = $2.9m',
      '$180k + $15k = $195k',
      '£2 billion + £500 million = £2.5 billion',
      '3 million people × $2 = $6 million',
      // The unit left unsaid on the result: right as the bare figures.
      '$3.5 million − $0.6 million = 2.9',
      // A result in millions is good to its last digit.
      '$1.25 million + $1.3 million = $2.6 million',
      // Metres, not millions.
      '5 m × 3 m = 15 m',
    ]) expect(arithmeticSlips(fine), fine).toEqual([]);
  });

  it('still finds a sum with scales that does not come out', () => {
    expect(arithmeticSlips('$3.5 million − $600,000 = $3.1 million')[0]).toContain('works out to 2,900,000, not 3,100,000');
    expect(arithmeticSlips('$180k + $15k = $200k')[0]).toContain('works out to 195,000, not 200,000');
    expect(arithmeticSlips('$2 million + $3 million = $6 million')).toHaveLength(1);
  });
});
