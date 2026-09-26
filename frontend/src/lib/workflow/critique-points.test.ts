import { describe, expect, it } from 'vitest';

import { findingFromPoint, pointsFromCommentary } from './critique-points';

describe('pointsFromCommentary — "buttonize it" (PM-22)', () => {
  it('turns each list item into a point, in order, with markdown removed', () => {
    const md = [
      '## The case against this draft',
      '1. **Unstated assumptions** — it assumes every reader knows what a vertebra is.',
      '2. **Weak reasoning** — "the only reason" is asserted, never shown.',
      '- A missing perspective: the fighting ("necking") explanation.',
      '  * nested points count too, if they say something substantial',
    ].join('\n');
    expect(pointsFromCommentary(md).map((p) => p.text)).toEqual([
      'Unstated assumptions — it assumes every reader knows what a vertebra is.',
      'Weak reasoning — "the only reason" is asserted, never shown.',
      'A missing perspective: the fighting ("necking") explanation.',
      'nested points count too, if they say something substantial',
    ]);
  });

  it('ignores prose, headings and throwaway fragments', () => {
    expect(pointsFromCommentary('Just a paragraph.\n# Heading\n- ok\n- fine')).toEqual([]);
  });

  it('caps the number of points', () => {
    const md = Array.from({ length: 30 }, (_, i) => `- point number ${i} with enough words`).join('\n');
    expect(pointsFromCommentary(md)).toHaveLength(20);
  });

  it('becomes a finding the apply endpoint takes', () => {
    const [p] = pointsFromCommentary('- The conclusion overreaches the evidence given.');
    expect(findingFromPoint(p, 'challenge')).toEqual({
      id: 'p1',
      category: 'challenge',
      summary: 'The conclusion overreaches the evidence given.',
      suggested_change: 'Revise the draft so this point is addressed.',
    });
  });
});

describe('real critiques nest', () => {
  const real = [
    'What works well is that it stays close to the objective.',
    '',
    '1. **Unstated assumptions**',
    '',
    '   - **It assumes an instruction is the same as the deliverable.**',
    '     The objective was a one-page explainer, but the answer is a',
    '     request to write one.',
    '   - **It assumes natural selection alone is the right framing.**',
    '     Other hypotheses are ignored.',
    '',
    '2. **Weak reasoning**',
    '   - **It overclaims certainty.** Scientists still debate this.',
    '',
    'Next logical step: rewrite it.',
  ].join('\n');

  it('sections become groups, bullets become points, indented prose becomes their detail', () => {
    expect(pointsFromCommentary(real)).toEqual([
      {
        id: 'p1',
        text: 'It assumes an instruction is the same as the deliverable.',
        detail: 'The objective was a one-page explainer, but the answer is a request to write one.',
        group: 'Unstated assumptions',
      },
      {
        id: 'p2',
        text: 'It assumes natural selection alone is the right framing.',
        detail: 'Other hypotheses are ignored.',
        group: 'Unstated assumptions',
      },
      { id: 'p3', text: 'It overclaims certainty. Scientists still debate this.', group: 'Weak reasoning' },
    ]);
  });

  it('the reviser is given the explanation, not just the headline', () => {
    const [p] = pointsFromCommentary(real);
    expect(findingFromPoint(p, 'The case against this draft')).toMatchObject({
      category: 'The case against this draft — Unstated assumptions',
      summary: 'It assumes an instruction is the same as the deliverable. — The objective was a one-page explainer, but the answer is a request to write one.',
    });
  });
});

describe('numbered sections with flush bullets (the other real shape)', () => {
  const md = [
    '1. **Unstated assumptions**',
    '',
    '- The answer assumes the two listed explanations are the only serious ones.',
    '- It assumes most of the height is neck, which is misleading.',
    '',
    '2. **Weak reasoning**',
    '',
    '- The jump from reaching leaves to long necks is too quick.',
    '',
    '4. **Opposite view**',
    '',
    'A well-reasoned argument against this answer would be:',
    '',
    '- The answer presents a tidy two-cause explanation for a debated question.',
  ].join('\n');

  it('labels are groups; bullets are points in the right group', () => {
    expect(pointsFromCommentary(md).map((p) => [p.group, p.text.slice(0, 30)])).toEqual([
      ['Unstated assumptions', 'The answer assumes the two lis'],
      ['Unstated assumptions', 'It assumes most of the height '],
      ['Weak reasoning', 'The jump from reaching leaves '],
      ['Opposite view', 'The answer presents a tidy two'],
    ]);
  });

  it('parses a real Challenge output (recorded from the real model)', async () => {
    const { readFileSync } = await import('node:fs');
    const points = pointsFromCommentary(readFileSync('src/lib/workflow/__fixtures__/real-challenge.md', 'utf8'));
    expect(points.length).toBeGreaterThan(10);
    expect(points.every((p) => !['Unstated assumptions', 'Weak reasoning', 'Missing perspectives', 'Opposite view'].includes(p.text))).toBe(true);
  });
});
