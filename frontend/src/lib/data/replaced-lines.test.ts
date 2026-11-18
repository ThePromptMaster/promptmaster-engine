import { describe, expect, it } from 'vitest';
import { changedLines, factsFromReplacedLines } from './replaced-lines';

// The 18 Nov hand pass: v2 of the pilot findings corrects one line.
const V1 = `Four-day week pilot: findings summary (invented test material)

Firms in the pilot: 14 small software firms, 9 to 60 staff each.
Median change in output: +3.1%.
Customer-reported incidents: unchanged (median 0 change).
Firms that kept the four-day week after the pilot: 11 of 14.`;
const V2 = V1.replace('Customer-reported incidents: unchanged (median 0 change).', 'Customer-reported incidents: up 12% at the median (corrected count).');

const fact = (id: string, statement: string, retired_at: string | null = null) => ({ id, statement, retired_at });

describe('a replaced document: what changed, and the facts that were its words', () => {
  it('pairs the changed line with its new line by its label', () => {
    expect(changedLines(V1, V2)).toEqual([{ before: 'Customer-reported incidents: unchanged (median 0 change).', after: 'Customer-reported incidents: up 12% at the median (corrected count).' }]);
  });

  it('pairs lines with no label in order when they changed one for one', () => {
    expect(changedLines('a\nThe pilot ran in spring.\nb', 'a\nThe pilot ran in summer.\nb')).toEqual([{ before: 'The pilot ran in spring.', after: 'The pilot ran in summer.' }]);
  });

  it('pairs nothing it cannot pair: a line only taken out, or only added', () => {
    expect(changedLines('a\nb\nc', 'a\nc')).toEqual([]);
    expect(changedLines('a\nc', 'a\nb\nc')).toEqual([]);
  });

  it('changes the fact that was the old line, and only that one', () => {
    const facts = [
      fact('f1', 'Customer-reported incidents: unchanged (median 0 change)'),
      fact('f2', 'Median change in output: +3.1%.'),
      fact('f3', 'Customer-reported incidents: unchanged (median 0 change).', '2026-11-17T00:00:00Z'),
      fact('f4', 'Incidents were unchanged.'),
    ];
    expect(factsFromReplacedLines(facts, changedLines(V1, V2))).toEqual([
      { fact: facts[0], statement: 'Customer-reported incidents: up 12% at the median (corrected count).' },
    ]);
  });

  it('changes nothing when the document did not change', () => {
    expect(factsFromReplacedLines([fact('f1', 'Median change in output: +3.1%.')], changedLines(V1, V1))).toEqual([]);
  });
});
