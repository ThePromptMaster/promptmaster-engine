// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contextFromDocuments, extractText, isDocument, tidyText } from './extract-text';

const fixture = (name: string) => {
  const buf = readFileSync(join(__dirname, '__fixtures__', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

describe('extractText', () => {
  it('reads the words of a PDF brief', async () => {
    const out = await extractText('brief.pdf', fixture('brief.pdf'));
    expect(out).toEqual({ text: expect.stringContaining('Gross margin fell from 31.2% to 24.8% in FY2025.') });
  });

  it('reads the words of a Word brief', async () => {
    const out = await extractText('brief.docx', fixture('brief.docx'));
    expect(out).toEqual({ text: 'Northstar board brief\n\nFunding is secured through Q3 2026.' });
  });

  it('reads Markdown and text as they are', async () => {
    const out = await extractText('notes.md', new TextEncoder().encode('# Notes\r\n\r\n\r\n\r\nKeep it short.  ').buffer as ArrayBuffer);
    expect(out).toEqual({ text: '# Notes\n\nKeep it short.' });
  });

  it('says why a file has no words rather than attaching an empty brief', async () => {
    expect(await extractText('blank.txt', new ArrayBuffer(0))).toEqual({ error: 'blank.txt has no text in it.' });
    const broken = await extractText('broken.docx', new TextEncoder().encode('not a zip').buffer as ArrayBuffer);
    expect(broken).toEqual({ error: expect.stringContaining('could not be read') });
  });
});

describe('documents into the project context', () => {
  it('adds each under its own heading after what was pasted', () => {
    const { context, cut } = contextFromDocuments('Pasted facts.', [{ name: 'brief.pdf', text: 'Margin fell.' }], 1_000);
    expect(context).toBe('Pasted facts.\n\n### From brief.pdf\n\nMargin fell.');
    expect(cut).toEqual([]);
  });

  it('says where a document was cut at the limit', () => {
    const { context, cut } = contextFromDocuments('', [{ name: 'long.pdf', text: 'x'.repeat(5_000) }], 1_000);
    expect(context.length).toBeLessThanOrEqual(1_000);
    expect(context).toMatch(/the rest of long\.pdf was not added/);
    expect(cut).toEqual(['long.pdf']);
  });

  it('knows a document from data', () => {
    expect(isDocument('brief.PDF')).toBe(true);
    expect(isDocument('sales.csv')).toBe(false);
    expect(tidyText('a  \n\n\n\nb')).toBe('a\n\nb');
  });
});
