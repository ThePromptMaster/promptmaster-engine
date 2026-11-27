import { describe, expect, it } from 'vitest';

import { manuscriptToDocx, markdownToBlocks } from './docx-export';

describe('markdownToBlocks', () => {
  it('turns the assembled manuscript into title, chapter headings, paragraphs and bullets', () => {
    const md = `# My book

## 1. Why cats scratch

Cats scratch to **mark** and to *stretch*.
It keeps claws sharp.

- one reason
- another reason

## 2. What to do

Offer a post.
`;
    expect(markdownToBlocks(md)).toEqual([
      { kind: 'title', text: 'My book' },
      { kind: 'h1', text: '1. Why cats scratch' },
      { kind: 'paragraph', text: 'Cats scratch to mark and to stretch. It keeps claws sharp.' },
      { kind: 'bullet', text: 'one reason' },
      { kind: 'bullet', text: 'another reason' },
      { kind: 'h1', text: '2. What to do' },
      { kind: 'paragraph', text: 'Offer a post.' },
    ]);
  });

  it('keeps a link\'s text and drops inline code marks', () => {
    expect(markdownToBlocks('See [the guide](https://x.y) and `code`.')).toEqual([{ kind: 'paragraph', text: 'See the guide and code.' }]);
  });
});

describe('manuscriptToDocx', () => {
  it('produces a Word file', async () => {
    const blob = await manuscriptToDocx('# T\n\n## 1. One\n\nBody.', 'T');
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain('wordprocessingml');
  });
});

describe('placed images (3 Oct call)', () => {
  it('reads an image on its own line as an image block', () => {
    expect(markdownToBlocks('Text\n\n![A lioness](project-file:11111111-aaaa)\n\nMore')).toEqual([
      { kind: 'paragraph', text: 'Text' },
      { kind: 'image', id: '11111111-aaaa', text: 'A lioness' },
      { kind: 'paragraph', text: 'More' },
    ]);
  });

  it('builds a Word file with an image it cannot embed captioned instead', async () => {
    const blob = await manuscriptToDocx('# T\n\n![Gone](project-file:22222222-bbbb)', 'T', {});
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('right-to-left lines (Sean, 24 Oct: Arabic)', () => {
  it('is read from the first letter', async () => {
    const { rightToLeft } = await import('./docx-export');
    expect(rightToLeft('مرحبا بالعالم')).toBe(true);
    expect(rightToLeft('1. مرحبا')).toBe(true);
    expect(rightToLeft('Hello مرحبا')).toBe(false);
    expect(rightToLeft('你好')).toBe(false);
  });
});

describe('tables are Word tables (27 Nov, production pass)', () => {
  const md = '# Plan\n\n## 1. Key dates\n\n| Step | Date |\n|---|---|\n| Delivery | Wednesday, April 7 |\n| Switch | **Tuesday, April 20** |\n\nAfter the table.';

  it('reads a header row, a rule row and the rows under it as one table', () => {
    expect(markdownToBlocks(md)).toEqual([
      { kind: 'title', text: 'Plan' },
      { kind: 'h1', text: '1. Key dates' },
      { kind: 'table', rows: [['Step', 'Date'], ['Delivery', 'Wednesday, April 7'], ['Switch', 'Tuesday, April 20']] },
      { kind: 'paragraph', text: 'After the table.' },
    ]);
  });

  it('a line of pipes with no rule row under it stays text', () => {
    expect(markdownToBlocks('| not a table |\nnext line')).toEqual([{ kind: 'paragraph', text: '| not a table | next line' }]);
  });

  it('a table at the very end is kept', () => {
    expect(markdownToBlocks('| A | B |\n|---|---|\n| 1 | 2 |').at(-1)).toEqual({ kind: 'table', rows: [['A', 'B'], ['1', '2']] });
  });

  it('the Word file holds a table, not the pipes', async () => {
    const blob = await manuscriptToDocx(md, 'Plan');
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:tbl>');
    expect(xml).not.toContain('|---|');
    expect(xml).toContain('Tuesday, April 20');
  });
});
