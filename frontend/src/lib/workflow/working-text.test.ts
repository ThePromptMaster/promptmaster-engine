import { describe, expect, it } from 'vitest';

import { strayWorkingText } from './working-text';

describe("the model's working left in a document (7 Nov, production)", () => {
  it('finds the lines from the saved package', () => {
    const v5 = [
      '| **Total** | $37,000 + $8,000 = **$45,000**? see below | | |',
      '',
      'Correction to the total line above: $37,000 + $8,000 = **$45,000** is the fixed costs plus training. The fixed costs are recalculated here in full:',
    ].join('\n');
    expect(strayWorkingText(v5)).toHaveLength(2);
  });

  it('finds second thoughts and a repeated row in one table', () => {
    expect(strayWorkingText('Wait, the total is wrong.')).toHaveLength(1);
    expect(strayWorkingText('Let me recalculate the total.')).toHaveLength(1);
    expect(strayWorkingText('| S1 | North | 4 |\n| S1 | North | 4 |')).toEqual(['| S1 | North | 4 |']);
  });

  it('leaves ordinary documents alone', () => {
    for (const fine of [
      'See below for the full schedule.',
      'Is the budget enough? See section 4.',
      'Correction to Chapter 1: the clause is Section 5.',
      'Wait times fell by 12%.',
      'Corrected passage: the clause is Section 5.',
      'The same row may recur.\n| Item | $4 | Open |\n\nA new document.\n\n| Item | $4 | Open |',
      '| H | H2 | H3 |\n|---|---|---|\n|---|---|---|',
      '| x |  |  |\n| x |  |  |',
    ]) {
      expect(strayWorkingText(fine), fine).toEqual([]);
    }
  });

  it('reads serialised rows as lines', () => {
    expect(strayWorkingText('{"finding":"a"}\\nCorrection to the row above: b')).toHaveLength(1);
  });
});
