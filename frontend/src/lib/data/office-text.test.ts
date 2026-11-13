// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

// The app reads a workbook with the browser build; the tests run in Node.
vi.mock('read-excel-file/browser', async () => {
  const { default: readNode } = await import('read-excel-file/node');
  return { default: (input: ArrayBuffer | Buffer) => readNode(Buffer.isBuffer(input) ? input : Buffer.from(input)) };
});

import { extractText, isDocument } from './extract-text';
import { deckToPptx } from '@/lib/export/pptx-export';
import { fileToText } from '@/lib/connections/read-file';
import type { ConnectedFile } from '@/lib/connections/items';

const bufferOf = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const workbook = () => bufferOf(readFileSync(join(__dirname, '../../../e2e/fixtures/churn-workbook.xlsx')));

const slide = (paragraphs: string[], attrs = '') =>
  `<?xml version="1.0"?><p:sld xmlns:a="a" xmlns:p="p"${attrs}><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs
    .map((p) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${p}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/** A deck whose order is not its file numbering, with a hidden slide and notes. */
const deck = () =>
  bufferOf(
    zipSync({
      'ppt/presentation.xml': strToU8(
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst></p:presentation>'
      ),
      'ppt/_rels/presentation.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="slide" Target="slides/slide3.xml"/><Relationship Id="rId9" Type="theme" Target="theme/theme1.xml"/></Relationships>'
      ),
      'ppt/slides/slide1.xml': strToU8(slide(['Margin &amp; mix', 'Gross margin fell from 31.2% to 24.8% &#8212; FY2025'])),
      'ppt/slides/slide2.xml': strToU8(slide(['Northstar board update', 'Q3 2026'])),
      'ppt/slides/slide3.xml': strToU8(slide(['Backup: do not present'], ' show="0"')),
      'ppt/notesSlides/notesSlide1.xml': strToU8(slide(['Speaker note: say nothing about the bid.'])),
      'docProps/app.xml': strToU8('<Properties/>'),
    })
  );

describe('a spreadsheet handed over from an account is read as its rows (13 Nov)', () => {
  it('gives each sheet that holds anything, under its name', async () => {
    const out = await extractText('churn-workbook.xlsx', workbook());
    if ('error' in out) throw new Error(out.error);
    expect(out.text).toContain('Sheet: Accounts\naccount_id,segment,seats,churned');
    expect(out.text).toContain('Sheet: Notes');
    expect(out.text).not.toContain('Sheet: Empty');
    expect(out.text).not.toMatch(/PK\u0003|\u0000/);
  });

  it('says a file that is not a workbook could not be read', async () => {
    expect(await extractText('broken.xlsx', bufferOf(strToU8('not a zip')))).toEqual({ error: expect.stringContaining('could not be read') });
  });
});

describe('a deck is read for the words on its slides (13 Nov)', () => {
  it('reads the slides in the deck\'s order, without hidden slides or speaker notes', async () => {
    const out = await extractText('update.pptx', deck());
    expect(out).toEqual({
      text: 'Slide 1\nNorthstar board update\nQ3 2026\n\nSlide 2\nMargin & mix\nGross margin fell from 31.2% to 24.8% — FY2025',
    });
    expect(isDocument('update.pptx')).toBe(true);
  });

  it('reads a deck the app itself exported', async () => {
    const blob = await deckToPptx(
      { title: 'Plan', slides: [{ title: 'Where we stand', bullets: ['Two interviews held', 'One deferred'], table: null, notes: 'Keep it short.' }, { title: 'Next', bullets: ['Send the update'], table: [['Who', 'When'], ['Avery', 'Thursday']], notes: '' }] },
      'Plan'
    );
    const out = await extractText('plan.pptx', await blob.arrayBuffer());
    if ('error' in out) throw new Error(out.error);
    expect(out.text).toContain('Where we stand');
    expect(out.text).toContain('Two interviews held');
    expect(out.text).toContain('Avery');
    expect(out.text).not.toContain('Keep it short.');
  });

  it('says so when it holds no slides, or is not a deck at all', async () => {
    const empty = bufferOf(zipSync({ 'docProps/app.xml': strToU8('<Properties/>') }));
    expect(await extractText('empty.pptx', empty)).toEqual({ error: expect.stringContaining('could not be read (it holds no slides)') });
    expect(await extractText('broken.pptx', bufferOf(strToU8('not a zip')))).toEqual({ error: expect.stringContaining('could not be read') });
  });
});

describe('bytes that are not text are never passed on as words (13 Nov)', () => {
  it('refuses a zip or a binary file under a name it has no reader for', async () => {
    expect(await extractText('notes.txt', deck())).toEqual({ error: expect.stringContaining('could not be read (it is not a text file)') });
    expect(await extractText('photo', bufferOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13])))).toEqual({ error: expect.stringContaining('could not be read') });
    expect(await extractText('notes.txt', bufferOf(strToU8('Plain words.')))).toEqual({ text: 'Plain words.' });
  });
});

describe('a file from Drive or OneDrive, read in the browser', () => {
  const file = (title: string, mime: string, data: ArrayBuffer): ConnectedFile => ({
    id: 'f1', toolkit: 'googledrive', source: 'Google Drive · file · me@example.com', title, mime, data_base64: Buffer.from(data).toString('base64'),
  });

  it('reads a spreadsheet and a deck as words, not as their bytes', async () => {
    const sheet = await fileToText(file('Churn', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workbook()), 'Could not be read.');
    expect(sheet).toMatchObject({ kind: 'file', toolkit: 'googledrive', title: 'Churn', text: expect.stringContaining('account_id,segment,seats,churned') });
    const slides = await fileToText(file('Board update.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', deck()), 'Could not be read.');
    expect(slides).toMatchObject({ kind: 'file', text: expect.stringContaining('Northstar board update') });
  });

  it('skips a file it cannot read, with the reason, rather than passing bytes on', async () => {
    const skipped = await fileToText(file('archive', 'application/zip', deck()), 'Could not be read.');
    expect(skipped).toEqual({ id: 'f1', title: 'archive', reason: expect.stringContaining('could not be read') });
  });
});
