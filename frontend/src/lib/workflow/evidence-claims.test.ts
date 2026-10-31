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

describe('definitions are not claims (31 Oct, Sean)', () => {
  it("Sean's sentence: a definition of a label is not a claim that something was verified", () => {
    expect(unsupportedClaims('Established means strongly supported by reliable, independently verified evidence.', none)).toEqual([]);
  });

  it('other ways of defining a word', () => {
    const text = [
      '"Verified" refers to a result checked against a cited source.',
      'Calculated is defined as produced by code that ran in this project.',
      '- **Established** — strongly supported by independently verified evidence.',
      'Confirmed stands for a result the user confirmed.',
    ].join('\n');
    expect(unsupportedClaims(text, none)).toEqual([]);
  });

  it('a glossary or evidence-scale section is read as definitions, up to the next heading', () => {
    const text = [
      '## Evidence scale',
      'Verified: checked against a cited source.',
      'Calculated — produced by a code run.',
      '## Findings',
      'We verified the migration figures.',
    ].join('\n');
    expect(unsupportedClaims(text, none).map((c) => c.quote)).toEqual(['We verified the migration figures.']);
  });

  it('"independently verified" describing evidence is not a claim; "was independently verified" is', () => {
    expect(unsupportedClaims('The study relies on independently verified records.', none)).toEqual([]);
    expect(unsupportedClaims('The rate was independently verified.', none)).toMatchObject([{ word: 'verified', needs: 'source' }]);
  });

  it('"this means" introduces a consequence, not a definition', () => {
    expect(unsupportedClaims('This means we verified the bound.', none)).toMatchObject([{ word: 'verified' }]);
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
