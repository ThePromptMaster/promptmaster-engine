/**
 * 2 Nov (Sean, photography workshop). The constraint said "Stay under 600
 * words in total, including headings, tables and a promotional message under
 * 80 words". The plan was measured without its headings: 566 words in code,
 * about 637 by his count. The plan also carried its own count of itself
 * ("**Length:** 545 words including headings and tables"), which was counted
 * as part of it.
 */
import { describe, expect, it } from 'vitest';

import { countWords, measure, parseRequirements } from './measurable';

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
  });
});
