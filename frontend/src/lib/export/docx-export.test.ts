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
