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
});
