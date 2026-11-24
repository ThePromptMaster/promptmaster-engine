import { describe, expect, it } from 'vitest';

import { linkQuotes, normalised, quotesIn, sourceDocs } from './quote-links';

const TRANSCRIPT = `Interviewer: Tell me about the carve-out.

Candidate: We separated the logistics arm in 2023 — I led the finance workstream, about forty people.
Candidate: Honestly, the board wanted it done in six months and we did it in nine.`;

describe('quotes a version makes', () => {
  it('finds quoted spans and > lines, and leaves short ones', () => {
    const text = 'She said “I led the finance workstream, about forty people” and "yes".\n> the board wanted it done in six months\nShort: "ok fine".';
    expect(quotesIn(text)).toEqual(['I led the finance workstream, about forty people', 'the board wanted it done in six months']);
  });

  it('in a table, reads fields named quote or evidence', () => {
    const json = JSON.stringify([{ topic: 'Carve-out', quote: 'We separated the logistics arm in 2023', finding: 'Led finance.' }]);
    expect(quotesIn(json)).toEqual(['We separated the logistics arm in 2023']);
  });
});

describe('the passage behind a quote', () => {
  const docs = sourceDocs(`Brief notes.\n\n### From Interview.docx\n\n${TRANSCRIPT}`, [
    { doc: { name: 'Position spec.pdf', text: 'Must have led a carve-out of at least 30 people.' }, level: { name: 'CFO search', kind: 'search' } },
  ]);

  it('is found word for word despite curly quotes, dashes, case and spacing, with raw offsets', () => {
    const [link] = linkQuotes(['we separated the logistics arm in 2023 - I led the finance   workstream'], docs);
    expect(link.doc.name).toBe('Interview.docx');
    expect(link.doc.text.slice(link.start, link.end)).toBe('We separated the logistics arm in 2023 — I led the finance workstream');
  });

  it('a quote with … is matched by its longest part', () => {
    const [link] = linkQuotes(['the board wanted it … done in six months and we did it in nine'], docs);
    expect(link.doc.text.slice(link.start, link.end)).toBe('done in six months and we did it in nine');
  });

  it("finds a folder's document too, and leaves out what is not in any", () => {
    const links = linkQuotes(['led a carve-out of at least 30 people', 'we delivered it in four months flat'], docs);
    expect(links.map((l) => [l.doc.name, l.doc.level?.name])).toEqual([['Position spec.pdf', 'CFO search']]);
  });

  it('counts every place it matches', () => {
    const [link] = linkQuotes(['Candidate: We separated the logistics'], [...docs, { name: 'Copy.docx', text: TRANSCRIPT, level: null }]);
    expect(link.matches).toBe(2);
  });

  it('keeps a map back to the raw text', () => {
    const n = normalised('A  **bold** “quote”');
    expect(n.norm).toBe('a bold "quote"');
    expect(n.at[n.norm.indexOf('b')]).toBe(5);
  });
});
