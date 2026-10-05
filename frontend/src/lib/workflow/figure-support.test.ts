import { describe, expect, it } from 'vitest';
import { figureFindings, unsupportedFigures } from './figure-support';

const brief = 'Northstar: revenue $412m in FY25, up from $388.5m. Gross margin fell from 31.2% to 24.6%. Plant 3 runs at 61% utilisation.';

describe('unsupportedFigures (4 Oct, item 11: invented recovery ranges)', () => {
  it('flags ranges and percentages no source contains — the memo\'s 15–25% and 5/10/15%', () => {
    const memo = 'Recovery could be 15–25% in year one. Options deliver 5/10/15% respectively.';
    expect(unsupportedFigures(memo, [brief])).toEqual(['15–25%', '5/10/15%']);
  });

  it('passes figures quoted from the brief, however written', () => {
    expect(unsupportedFigures('Revenue reached $412m while margin fell to 24.6% and Plant 3 sat at 61%.', [brief])).toEqual([]);
    expect(unsupportedFigures('Revenue of $412 million.', [brief])).toEqual([]);
  });

  it('a plant number is not a source for a percentage (E2E, 4 Oct brief)', () => {
    expect(unsupportedFigures('Recovery of 15–25%.', ['Plant 15 and Plant 25 report monthly.'])).toEqual(['15–25%']);
  });

  it('a range is supported only if both ends are', () => {
    expect(unsupportedFigures('Margin moved between 24.6% and 31.2%.', [brief])).toEqual([]);
    expect(unsupportedFigures('Margin of 24.6–40%.', [brief])).toEqual(['24.6–40%']);
  });

  it('does not judge plain counts, years, labels or list numbers', () => {
    const text = '1. Close 2 plants within 18 months.\n2. In 2026, Stage 3 and FY27 targets apply; Option 2 keeps 400 staff.';
    expect(unsupportedFigures(text, [])).toEqual([]);
  });

  it('a figure labelled as an assumption in its sentence is allowed', () => {
    expect(unsupportedFigures('Assumption: a 12% price rise holds.', [])).toEqual([]);
    expect(unsupportedFigures('An illustrative 20% cut is shown.', [])).toEqual([]);
    expect(unsupportedFigures('A bounded scenario of 20% applies.', [])).toEqual(['20%']);
  });

  it('becomes one finding that names the figures', () => {
    const [finding] = figureFindings('Upside of 15–25% and $3.5m in savings.', [brief]);
    expect(finding.category).toBe('Unsupported figures');
    expect(finding.summary).toBe('2 figures have no source in the project: 15–25%, $3.5m.');
    expect(finding.suggested_change).toContain('Assumption:');
    expect(figureFindings('Revenue was $412m.', [brief])).toEqual([]);
  });
});
