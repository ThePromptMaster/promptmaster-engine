import { describe, expect, it } from 'vitest';

import {
  describeScope,
  documentSections,
  resolveScope,
  spliceScope,
} from './chat-scope';

const DOC = `# Opening

The case for governing AI-assisted work.

## Why now

Regulators have started asking.

## What this is not

It is not a book about prompting.
`;

describe('documentSections', () => {
  it('splits on headings and names each section', () => {
    expect(documentSections(DOC).map((s) => s.title)).toEqual([
      'Opening',
      'Why now',
      'What this is not',
    ]);
  });

  it('gives a heading-less document no sections at all', () => {
    // Not "one section covering everything". The section scope is then
    // unavailable, which is honest; silently meaning the whole document is the
    // failure mode this whole module exists to prevent.
    expect(documentSections('Just some prose, no headings anywhere.')).toEqual([]);
  });

  it('carries subsections along with the section above them', () => {
    const nested = '# Chapter\n\nIntro.\n\n### Aside\n\nDetail.\n';
    const [chapter] = documentSections(nested);
    // A user pointing at "Chapter" means the chapter, not its first paragraph.
    expect(nested.slice(chapter.start, chapter.end)).toContain('Intro.');
    expect(nested.slice(chapter.start, chapter.end)).not.toContain('Detail.');
  });
});

describe('resolveScope', () => {
  it('resolves the whole document', () => {
    const target = resolveScope(DOC, 'document')!;
    expect(target.text).toBe(DOC);
    expect(target.label).toMatch(/whole document/i);
  });

  it('resolves one section to exactly its own characters', () => {
    const section = documentSections(DOC)[1];
    const target = resolveScope(DOC, 'section', { sectionId: section.id })!;
    expect(target.text).toContain('Regulators have started asking.');
    expect(target.text).not.toContain('It is not a book about prompting.');
    expect(target.label).toContain('Why now');
  });

  it('resolves a selection to where it actually sits in the source', () => {
    const target = resolveScope(DOC, 'selection', {
      selection: 'Regulators have started asking.',
    })!;
    expect(DOC.slice(target.start, target.end)).toBe('Regulators have started asking.');
  });

  it('refuses rather than widening when a scope cannot be found', () => {
    // The single worst thing this feature could do is quietly turn a
    // selection-scoped revision into a whole-document rewrite.
    expect(resolveScope(DOC, 'selection', { selection: 'text that is not here' })).toBeNull();
    expect(resolveScope(DOC, 'section', { sectionId: 'nope' })).toBeNull();
    expect(resolveScope('   ', 'document')).toBeNull();
    expect(resolveScope(DOC, 'selection', { selection: '   ' })).toBeNull();
  });
});

describe('spliceScope', () => {
  it('replaces only the target span', () => {
    const section = documentSections(DOC)[1];
    const target = resolveScope(DOC, 'section', { sectionId: section.id })!;
    const next = spliceScope(DOC, target, '## Why now\n\nBecause the rules changed.');

    expect(next).toContain('Because the rules changed.');
    expect(next).not.toContain('Regulators have started asking.');
    // Everything either side survives untouched.
    expect(next).toContain('The case for governing AI-assisted work.');
    expect(next).toContain('It is not a book about prompting.');
  });

  it('edits the span it was given, not the first matching text', () => {
    // "Repeat." appears twice; a find-and-replace would edit the wrong one.
    const doc = 'Repeat.\n\nRepeat.';
    const target = { kind: 'selection' as const, label: '', text: 'Repeat.', start: 9, end: 16 };
    expect(spliceScope(doc, target, 'Changed.')).toBe('Repeat.\n\nChanged.');
  });
});

describe('describeScope', () => {
  it('truncates a long passage for the preview', () => {
    const target = resolveScope('x'.repeat(500), 'document')!;
    const shown = describeScope(target, 100);
    expect(shown.length).toBeLessThanOrEqual(101);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('leaves a short passage whole', () => {
    const target = resolveScope('Short enough.', 'document')!;
    expect(describeScope(target)).toBe('Short enough.');
  });
});
