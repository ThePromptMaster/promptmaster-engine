import { describe, expect, it } from 'vitest';
import { onlyRewords, proseRewords } from './rewording';

const ANALYSIS =
  'The two-interval Rényi-2 entropy was computed for L = 64 (O1). The mutual information falls as 1/d^2 [S2], ' +
  'which supports the area-law reading. The fit gives c = 0.98 with residual 0.03. Further runs at larger sizes ' +
  'would tighten the estimate, and the boundary terms are treated as in the plan.';

describe('a version that only rewords the last (25 Oct)', () => {
  it('is a rewording when the figures, IDs, citations and claims are the same', () => {
    const after = ANALYSIS.replace('which supports the area-law reading', 'which is consistent with the area-law reading').replace(
      'are treated as in the plan',
      'are handled as the plan set out'
    );
    expect(onlyRewords(ANALYSIS, after)).toBe(true);
  });

  it('is a change when a figure moves', () => {
    expect(onlyRewords(ANALYSIS, ANALYSIS.replace('c = 0.98', 'c = 0.91'))).toBe(false);
  });

  it('is a change when an item ID or a citation changes', () => {
    expect(onlyRewords(ANALYSIS, ANALYSIS.replace('(O1)', '(O2)'))).toBe(false);
    expect(onlyRewords(ANALYSIS, ANALYSIS.replace('[S2]', '[S3]'))).toBe(false);
  });

  it('is a change when a claim is turned round or hedged', () => {
    expect(onlyRewords(ANALYSIS, ANALYSIS.replace('which supports', 'which does not support'))).toBe(false);
    expect(onlyRewords(ANALYSIS, ANALYSIS.replace('which supports', 'which may support'))).toBe(false);
  });

  it('is a change when many words change, even without a figure', () => {
    const after = `${ANALYSIS} A second method based on the replica trick was also tried and agreed with the first one closely enough.`;
    expect(proseRewords(ANALYSIS, after)).toBe(false);
  });

  it('is not a rewording when nothing changed or one side is empty', () => {
    expect(onlyRewords(ANALYSIS, ANALYSIS)).toBe(false);
    expect(onlyRewords('', ANALYSIS)).toBe(false);
  });

  it('keeps every row, ID and status of structured content; only its text may be reworded', () => {
    const rows = (status: string, text: string) =>
      JSON.stringify({ items: [{ id: 'H1', text, status, status_source: 'user' }, { id: 'H2', text: 'Boundary terms vanish at large L.', status: 'open', status_source: 'model' }] });
    const before = rows('supported', 'The entropy follows the area law for every size tested in the plan above.');
    expect(onlyRewords(before, rows('supported', 'The entropy follows the area law for every size tested in the plan set out above.'))).toBe(true);
    expect(onlyRewords(before, rows('rejected', 'The entropy follows the area law for every size tested in the plan above.'))).toBe(false);
    expect(onlyRewords(before, JSON.stringify({ items: [JSON.parse(before).items[0]] }))).toBe(false);
  });

  it('is a change when prose becomes structured or the other way round', () => {
    expect(onlyRewords(ANALYSIS, JSON.stringify({ items: [] }))).toBe(false);
  });
});
