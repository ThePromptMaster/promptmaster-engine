/**
 * 2 Nov (Sean, photography workshop). The constraint said "Stay under 600
 * words in total, including headings, tables and a promotional message under
 * 80 words". The plan was measured without its headings: 566 words in code,
 * about 637 by his count. The plan also carried its own count of itself
 * ("**Length:** 545 words including headings and tables"), which was counted
 * as part of it.
 */
import { describe, expect, it } from 'vitest';

import { countWords, measure, parseRequirements, requirementsForStage } from './measurable';
import type { StageDefinition } from './types';

const CONSTRAINT =
  'Use only the supplied facts, with no outside data. Stay under 600 words in total, including headings, tables and a promotional message under 80 words.';

describe('a word limit that says its headings count', () => {
  it('is read with its counting rule', () => {
    const [all] = parseRequirements([CONSTRAINT]);
    expect(all).toMatchObject({ id: 'words:all', max: 600, headings: true });
    expect(parseRequirements(['Keep it under 300 words, headings included.'])[0].headings).toBe(true);
    expect(parseRequirements(['At most 300 words, counting the headings.'])[0].headings).toBe(true);
  });

  it('"with headings and tables" says what the text has, not what is counted', () => {
    const reqs = parseRequirements(['Decision and launch plan under 600 words with headings and tables: Facts / Options / Next steps']);
    expect(reqs.every((r) => !r.headings)).toBe(true);
    expect(parseRequirements(['Under 600 words.'])[0].headings).toBeUndefined();
  });

  it('a requirement recorded as "Whole document under 600 words, including headings" is the whole', () => {
    expect(parseRequirements(['Whole document under 600 words, including headings and tables.'])).toEqual([
      expect.objectContaining({ id: 'words:all', subject: '', max: 600, headings: true }),
    ]);
    expect(parseRequirements(['Executive update must be no more than 100 words.'])[0].subject).toBe('executive update');
  });

  it('the same limit said again keeps the rule', () => {
    const [all] = parseRequirements(['Under 600 words.', CONSTRAINT]);
    expect(all).toMatchObject({ id: 'words:all', headings: true });
  });

  it('counts the headings then, and says so with the limit', () => {
    const body = Array.from({ length: 580 }, () => 'word').join(' ');
    const text = `# Launch plan for the workshop\n\n## Facts supplied\n\n${body}\n\n## Options compared and calculations\n\n## Reserve check\n\n## Next steps`;
    expect(countWords(text)).toBe(580);
    // 5 + 2 + 4 + 2 + 2 words of headings.
    expect(countWords(text, { headings: true })).toBe(580 + 15);

    const [all] = parseRequirements([CONSTRAINT]);
    expect(measure(all, text, true)).toMatchObject({ label: 'The deliverable: at most 600 words (headings included)', satisfied: true, value: '595 words' });
    // Six more words of heading take it over, though its prose is unchanged.
    expect(measure(all, `${text}\n\n## One more longer section heading here`, true)).toMatchObject({ satisfied: false, value: '601 words' });

    const [plain] = parseRequirements(['Under 600 words.']);
    expect(measure(plain, text, true)!.label).toBe('The deliverable: at most 600 words');
  });

  it("the text's own count of itself is not part of it", () => {
    const text = 'One two three four five.\n\n**Length:** 545 words including headings and tables; promotional message 71 words.';
    expect(countWords(text)).toBe(5);
    expect(countWords(text, { headings: true })).toBe(5);
    expect(countWords('Length: 2 hours, in person.')).toBe(5);
    expect(countWords('> New to photography? Join us.\n\nMessage: 55 words, counted by hand.')).toBe(5);
    expect(countWords('Section two covers 300 words of history.')).toBe(7);
  });
});

describe('one text, one count (2 Nov, production pass)', () => {
  const finalPlan = { id: 'final', label: 'Final decision and launch plan', renderer: 'prose', exit_criteria: [], expected_artifacts: [{ kind: 'final_plan', primary: true }] } as unknown as StageDefinition;
  it('the output format\'s "launch plan under 600 words" and the constraint\'s whole-plan limit are measured once, headings counted', () => {
    const reqs = parseRequirements([
      'Keep the whole plan under 600 words.',
      'Decision and launch plan under 600 words with headings and tables: facts, calculations, next steps',
      'Whole document under 600 words, including headings and tables.',
    ]);
    const applied = requirementsForStage(finalPlan, 'final', reqs);
    const words = applied.filter(({ requirement: r }) => r.kind === 'words');
    expect(words).toHaveLength(1);
    expect(words[0].requirement).toMatchObject({ max: 600, headings: true });
  });

  it('a part the stage\'s instruction mentions keeps its own rule', () => {
    const withHint = { ...finalPlan, entry_prompt_hint: 'Assemble the plan, including the promotional message.' } as unknown as StageDefinition;
    const reqs = parseRequirements(['Stay under 600 words in total, including headings.', 'The promotional message must be under 80 words.']);
    const words = requirementsForStage(withHint, 'final', reqs).filter(({ requirement: r }) => r.kind === 'words');
    expect(words.map(({ requirement: r }) => [r.subject, r.max, Boolean(r.headings)])).toEqual([['', 600, true], ['promotional message', 80, false]]);
  });

  it('two different limits on the whole are both kept, with one counting rule', () => {
    const reqs = parseRequirements(['Stay under 600 words in total, including headings.', 'The launch plan must be at least 300 words.']);
    const words = requirementsForStage(finalPlan, 'final', reqs).filter(({ requirement: r }) => r.kind === 'words');
    expect(words.map(({ requirement: r }) => [r.min ?? null, r.max ?? null, Boolean(r.headings)])).toEqual([[null, 600, true], [300, null, true]]);
  });
});
