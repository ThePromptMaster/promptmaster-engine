// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { MAX_CHAPTERS, looksLikeManuscript, splitChapters } from './chapters';
import { longFormFromOutline } from '@/lib/outline/long-form';
import { abstractOf, manuscriptOutline, manuscriptNote } from '@/lib/outline/import-manuscript';

const body = (words: number, seed = 'The river ran on.') => Array.from({ length: words / 4 }, () => seed).join(' ');

describe("a manuscript's chapters, from its own text (15 Nov: a tester's book)", () => {
  it('splits on the headings Word, EPUB and ODT keep, and keeps a long opening as its own part', () => {
    const text = `${body(200, 'A title page and a long dedication that runs on.')}\n\n# Chapter One\n\n${body(40)}\n\n# Chapter Two\n\nIt ended.`;
    const chapters = splitChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['Opening', 'Chapter One', 'Chapter Two']);
    expect(chapters[2].text).toBe('It ended.');
  });

  it('splits on lines that name a chapter, and not on prose that starts the same way', () => {
    const text = ['Title', 'CHAPTER 1', 'Part of me wanted to stay.', 'It rained.', 'Chapter 2: The Return', 'Book one of the trilogy sat there.', 'Epilogue', 'Done.'].join('\n\n');
    const chapters = splitChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['CHAPTER 1', 'Chapter 2: The Return', 'Epilogue']);
    expect(chapters[0].text).toContain('Part of me wanted to stay.');
    expect(chapters[0].text.startsWith('Title')).toBe(true);
  });

  it('cuts text with no chapter marks into parts at paragraph breaks, losing nothing', () => {
    const paras = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`.trim());
    const text = paras.join('\n\n');
    const chapters = splitChapters(text);
    expect(chapters.length).toBeGreaterThan(3);
    expect(chapters.length).toBeLessThanOrEqual(MAX_CHAPTERS);
    expect(chapters[0].title).toBe('Part 1');
    expect(chapters.map((c) => c.text).join('\n\n').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('calls a long text with chapters a manuscript, and a short brief not', () => {
    expect(looksLikeManuscript(`# One\n\n${body(12_000)}\n\n# Two\n\n${body(12_000)}`)).toBe(true);
    expect(looksLikeManuscript('# One\n\nShort.\n\n# Two\n\nBrief.')).toBe(false);
  });
});

describe('the manuscript as the book\'s chapters', () => {
  it('gives the outline and the written sections the same ids, so approving the outline keeps the text', () => {
    let n = 0;
    const { doc, sections } = manuscriptOutline(
      [{ title: 'Chapter One', text: 'It began here. Then more.' }, { title: 'Chapter Two', text: 'It ended.' }],
      () => `id-${++n}`,
      '2026-11-15T00:00:00Z'
    );
    expect(doc.items.map((i) => i.id)).toEqual(['id-1', 'id-2']);
    expect(sections.every((s) => s.status === 'complete')).toBe(true);
    const imported = { state: 'review_outline' as const, current_section_index: 2, outline: sections, continuity_snapshot: null, started_at: 'x', completed_at: null };
    const approved = longFormFromOutline(doc, imported);
    expect(approved.state).toBe('complete');
    expect(approved.outline.map((s) => s.content)).toEqual(['It began here. Then more.', 'It ended.']);
  });

  it('describes a chapter by its first sentence, and leaves a note in the context', () => {
    expect(abstractOf('It was a cold morning in March. Nobody came.')).toBe('It was a cold morning in March.');
    expect(manuscriptNote('book.docx', 24, 417_453)).toBe("### From book.docx\n\n[Imported as the book's 24 chapters (417,453 characters). The chapters hold the text, word for word.]");
  });
});
