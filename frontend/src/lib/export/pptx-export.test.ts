import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { deckFromMarkdown, deckToPptx, isDeck } from './pptx-export';

const DECK = `# Q3 board update

Some words before the first slide.

## Slide 1: Growth slowed, and we know why

- ARR is **$18.4M**, up from $16.9M
- New ARR missed plan: $1.1M against $1.6M

Speaker notes: Say the miss out loud first.

## Runway is 15 months, not 18

| Measure | Value |
|---|---|
| Cash | $9.2M |
| Net burn | $610k a month |

**Speaker notes:** The note said 18 months.
It does not add up.

---

## The ask

1. Approve hiring six reps
2. Or hold until the sync ships

### Speaker notes

Lead with what the numbers say.
`;

describe('deckFromMarkdown', () => {
  it('reads each heading as a slide, with its bullets, table and notes', () => {
    const deck = deckFromMarkdown(DECK);
    expect(deck.title).toBe('Q3 board update');
    expect(deck.slides.map((s) => s.title)).toEqual([
      'Growth slowed, and we know why',
      'Runway is 15 months, not 18',
      'The ask',
    ]);
    expect(deck.slides[0].bullets).toEqual(['ARR is $18.4M, up from $16.9M', 'New ARR missed plan: $1.1M against $1.6M']);
    expect(deck.slides[0].notes).toBe('Say the miss out loud first.');
    expect(deck.slides[1].table).toEqual([['Measure', 'Value'], ['Cash', '$9.2M'], ['Net burn', '$610k a month']]);
    expect(deck.slides[1].notes).toBe('The note said 18 months.\nIt does not add up.');
    expect(deck.slides[1].bullets).toEqual([]);
    expect(deck.slides[2].bullets).toEqual(['Approve hiring six reps', 'Or hold until the sync ships']);
    expect(deck.slides[2].notes).toBe('Lead with what the numbers say.');
  });

  it('finds slides at whichever level they were written', () => {
    const atThree = '# Title\n\n### Slide one\n- a\n\n### Slide two\n- b\n\n### Slide three\n- c\n';
    expect(deckFromMarkdown(atThree).slides.map((s) => s.title)).toEqual(['Slide one', 'Slide two', 'Slide three']);
    const atOne = '# One\n- a\n\n# Two\n- b\n\n# Three\n- c\n';
    expect(deckFromMarkdown(atOne).slides).toHaveLength(3);
    expect(deckFromMarkdown(atOne).title).toBe('');
    const bold = '**Slide 1: Where we stand**\n- a\n\n**Slide 2: What changed**\n- b\n\n**Slide 3: The ask**\n- c\n';
    expect(deckFromMarkdown(bold).slides.map((s) => s.title)).toEqual(['Where we stand', 'What changed', 'The ask']);
  });

  it('does not count a notes heading as a slide', () => {
    const doc = '## One\n- a\n### Notes\nSay a.\n## Two\n- b\n### Notes\nSay b.\n## Three\n- c\n';
    const deck = deckFromMarkdown(doc);
    expect(deck.slides.map((s) => s.title)).toEqual(['One', 'Two', 'Three']);
    expect(deck.slides[1].notes).toBe('Say b.');
  });

  it('leaves code blocks off the slides', () => {
    const doc = '## One\n```\n## not a slide\n```\n- a\n## Two\n- b\n## Three\n- c\n';
    const deck = deckFromMarkdown(doc);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].bullets).toEqual(['a']);
  });
});

describe('isDeck', () => {
  it('offers a document laid out as slides, and not prose or an empty one', () => {
    expect(isDeck(DECK)).toBe(true);
    expect(isDeck('')).toBe(false);
    expect(isDeck('# A memo\n\nOne long paragraph.\n\n## Background\n\nMore.\n')).toBe(false);
    expect(isDeck('# A memo\n\n## One\n\n## Two\n')).toBe(false);
  });
});

describe('deckToPptx', () => {
  it('writes a file PowerPoint can open: a cover, each slide, its table and its notes', async () => {
    const buffer = await deckToPptx(deckFromMarkdown(DECK), 'Fallback', 'arraybuffer');
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('ppt/presentation.xml');
    // The cover and three slides.
    expect(names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(4);

    const read = (n: string) => zip.file(n)!.async('string');
    expect(await read('ppt/slides/slide1.xml')).toContain('Q3 board update');
    expect(await read('ppt/slides/slide2.xml')).toContain('Growth slowed, and we know why');
    expect(await read('ppt/slides/slide2.xml')).toContain('ARR is $18.4M, up from $16.9M');
    expect(await read('ppt/slides/slide3.xml')).toContain('$610k a month');
    expect(await read('ppt/notesSlides/notesSlide2.xml')).toContain('Say the miss out loud first.');
  });

  it('uses the project title when the document has none, and writes right to left when the words do', async () => {
    const deck = deckFromMarkdown('## واحد\n- أ\n## اثنان\n- ب\n## ثلاثة\n- ج\n');
    const zip = await JSZip.loadAsync(await deckToPptx(deck, 'عنوان المشروع', 'arraybuffer'));
    const cover = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(cover).toContain('عنوان المشروع');
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('rtl="1"');
  });
});
