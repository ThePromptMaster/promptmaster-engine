import { describe, expect, it } from 'vitest';

import { headingOutline, joinParts, needsParts, partInstruction, splitIntoParts } from './long-prose';
import { countWords } from './measurable';

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
/** A book as Sean's was: chapters under `#`, each a few thousand words, and an introduction. */
const book = (chapters: number, each: number) =>
  `Introduction. ${words(200)}\n\n` +
  Array.from({ length: chapters }, (_, i) => `# Chapter ${i + 1}\n\n${words(each / 2)}\n\n${words(each / 2)}\n`).join('\n');

describe('a prose text too long for one call is cut into parts (31 Oct, Sean)', () => {
  it('a short text is one part', () => {
    expect(needsParts(words(4_000))).toBe(false);
    expect(splitIntoParts(words(4_000))).toEqual([words(4_000)]);
  });

  it('cuts a book at its chapters, every part within the limit, and loses nothing', () => {
    const text = book(12, 3_000);
    const parts = splitIntoParts(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(countWords(p)).toBeLessThanOrEqual(5_000);
    // A chapter is never split across parts when it fits in one.
    for (const p of parts.slice(1)) expect(p.startsWith('# Chapter')).toBe(true);
  });

  it('puts small chapters together up to the limit', () => {
    const parts = splitIntoParts(book(30, 400));
    expect(parts.length).toBeLessThan(10);
  });

  it('a chapter longer than a part is cut at its sub-headings, then at paragraphs', () => {
    const text = `# One\n\n## A\n\n${words(4_000)}\n\n## B\n\n${words(4_000)}\n\n# Two\n\n${words(3_000)}\n\n${words(3_000)}\n`;
    const parts = splitIntoParts(text);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(countWords(p)).toBeLessThanOrEqual(5_000);
  });

  it('a heading inside a code fence is not a place to cut', () => {
    const text = `# Real\n\n${words(3_000)}\n\n\`\`\`\n# not a heading\n\`\`\`\n\n${words(3_000)}\n`;
    expect(headingOutline(text)).toBe('# Real');
  });

  it('tells each part where it sits and to return only itself, with no sources list', () => {
    const line = partInstruction(1, 4, '# Chapter 1\n# Chapter 2');
    expect(line).toContain('part 2 of 4');
    expect(line).toContain('# Chapter 2');
    expect(line).toMatch(/Return ONLY this part/);
    expect(line).toMatch(/list of sources/);
  });

  it('joins revised parts so each next heading starts its own line', () => {
    expect(joinParts(['Intro text.', '# Chapter 1\n\nBody.\n'])).toBe('Intro text.\n\n# Chapter 1\n\nBody.\n');
  });
});
