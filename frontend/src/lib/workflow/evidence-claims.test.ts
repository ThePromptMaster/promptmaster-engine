import { describe, expect, it } from 'vitest';
import { describeUnsupported, unsupportedClaims } from './evidence-claims';
import { measureEvidence } from './context';

const none = { codeRuns: 0 };
const ran = { codeRuns: 1 };

describe('results called calculated or verified (L-118)', () => {
  it('a label or a statement that it was done is a claim; with nothing run, it is unsupported', () => {
    const text = [
      '**Calculated** — the ratio c_{n+1}/c_n tends to 2.638.',
      'The entropy bound was computed for n up to 12.',
      'We verified the area law in the two-interval case.',
    ].join('\n');
    const claims = unsupportedClaims(text, none);
    expect(claims.map((c) => [c.word, c.needs])).toEqual([
      ['calculated', 'run'],
      ['computed', 'run'],
      ['verified', 'source'],
    ]);
  });

  it('a clean code run backs "calculated"; a citation backs "verified"', () => {
    const text = [
      'Calculated — the ratio tends to 2.638.',
      'Externally verified: the bound matches Casini and Huerta [S2].',
      'The constant was confirmed by the user.',
      'Verified (doi:10.1103/PhysRevD.1).',
    ].join('\n');
    expect(unsupportedClaims(text, ran)).toEqual([]);
  });

  it('a verification done by computing needs a run, not a source', () => {
    expect(unsupportedClaims('The identity was numerically verified to 10 digits.', none)).toMatchObject([{ needs: 'run' }]);
    expect(unsupportedClaims('The identity was numerically verified to 10 digits.', ran)).toEqual([]);
  });

  it('a negated, deferred or hedged mention is not a claim', () => {
    const text = [
      'The ratio has not been calculated yet.',
      'This is to be verified against the literature.',
      'Once computed, the bound would fix the constant.',
      'Reasoned (not calculated): the series converges.',
      'Conditional — if the cutoff holds, the sum is finite.',
      'The next step is that the integral should be computed numerically.',
    ].join('\n');
    expect(unsupportedClaims(text, none)).toEqual([]);
  });

  it('ordinary uses of the words are not labels', () => {
    const text = [
      'The ratio is calculated as A divided by B.',
      'A calculated risk is still a risk.',
      'The verified accounts are listed below.',
    ].join('\n');
    expect(unsupportedClaims(text, none)).toEqual([]);
  });

  it('a code block is not read', () => {
    expect(unsupportedClaims('```python\n# result was computed: 2.6\n```', none)).toEqual([]);
  });

  it('says what is wrong and what fixes it', () => {
    const line = describeUnsupported(unsupportedClaims('Calculated — 2.638.\nWe confirmed the bound.', none));
    expect(line).toContain('1 called calculated with no code run in this project ("Calculated — 2.638.")');
    expect(line).toContain('1 called confirmed with no source cited');
    expect(line).toContain('reasoned, conditional or speculative');
  });
});

describe('measureEvidence', () => {
  const prose = { renderer: 'prose' as const };
  it('measures research and inquiry prose only', () => {
    const text = 'Calculated — 2.638.';
    expect(measureEvidence({}, { key: 'research' }, prose, text)).toMatchObject({ id: 'measured.evidence', satisfied: false });
    expect(measureEvidence({}, { key: 'custom_x', inquiry: true }, prose, text)).toMatchObject({ satisfied: false });
    expect(measureEvidence({}, { key: 'book' }, prose, text)).toBeNull();
    expect(measureEvidence({}, { key: 'research' }, { renderer: 'list' }, text)).toBeNull();
  });

  it('a run in the project satisfies it', () => {
    expect(measureEvidence({ code_runs: ['r1'] }, { key: 'research' }, prose, 'Calculated — 2.638.')).toMatchObject({ satisfied: true });
  });
});
