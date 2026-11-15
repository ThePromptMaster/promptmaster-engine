// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { strToU8, zipSync } from 'fflate';

import { contextFromDocuments, extractText, htmlText, isDocument, rtfText, tidyText } from './extract-text';
import { rejectReason } from './preview';

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

describe('calendar invites and saved emails', () => {
  const read = async (name: string, text: string) => extractText(name, new TextEncoder().encode(text).buffer as ArrayBuffer);

  it('offers both as documents', () => {
    expect(isDocument('invite.ics')).toBe(true);
    expect(isDocument('thread.eml')).toBe(true);
  });

  it('reads who, what and when from an invite, across folded lines, labelled as other people\'s words', async () => {
    const ics = [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Cascadia\\, contract renewal',
      'DTSTART;TZID=America/New_York:20261119T140000', 'DTEND;TZID=America/New_York:20261119T144500',
      'LOCATION:Video call', 'ORGANIZER;CN=Lena Voss:mailto:lena@example.org',
      'ATTENDEE;CN="Dana Okafor";ROLE=REQ-PARTICIPANT:mailto:dana@example.org',
      'DESCRIPTION:Agenda:\\n1. Renewal term\\n2. 2027 prici', ' ng', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const out = await read('invite.ics', ics);
    expect(out).toEqual({ text: expect.stringContaining("Calendar invite, in other people's words") });
    const text = (out as { text: string }).text;
    expect(text).toContain('What: Cascadia, contract renewal');
    expect(text).toContain('When: 2026-11-19 14:00 (America/New_York) to 2026-11-19 14:45 (America/New_York)');
    expect(text).toContain('Where: Video call');
    expect(text).toContain('Organizer: Lena Voss (lena@example.org)');
    expect(text).toContain('Attendees: Dana Okafor (dana@example.org)');
    expect(text).toContain('Agenda:\n1. Renewal term\n2. 2027 pricing');
  });

  it('reads a plain email with its headers, and decodes an encoded subject', async () => {
    const eml = 'From: Lena Voss <lena@example.org>\r\nTo: Dana <dana@example.org>\r\nDate: Tue, 3 Nov 2026 09:00:00 -0500\r\nSubject: =?UTF-8?B?UHJpY2VzIOKAlCAyMDI3?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPrices go up 6%.\r\n';
    const text = ((await read('m.eml', eml)) as { text: string }).text;
    expect(text).toContain("Email, in other people's words");
    expect(text).toContain('From: Lena Voss <lena@example.org>');
    expect(text).toContain('Subject: Prices \u2014 2027');
    expect(text).toContain('Prices go up 6%.');
  });

  it('prefers the plain part, decodes it, and leaves attachments out', async () => {
    const eml = [
      'From: a@example.org', 'Subject: Quote', 'Content-Type: multipart/mixed; boundary="OUTER"', '',
      '--OUTER', 'Content-Type: multipart/alternative; boundary="INNER"', '',
      '--INNER', 'Content-Type: text/html; charset=utf-8', '', '<p>The HTML version</p>',
      '--INNER', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Corrugated +8.5%=', ' and caf=C3=A9', '--INNER--',
      '--OUTER', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename="secret.txt"', '', 'NOT THIS', '--OUTER--', '',
    ].join('\r\n');
    const text = ((await read('m.eml', eml)) as { text: string }).text;
    expect(text).toContain('Corrugated +8.5% and caf\u00e9');
    expect(text).not.toContain('The HTML version');
    expect(text).not.toContain('NOT THIS');
  });

  it('reads an HTML-only email as words, and base64 too', async () => {
    const html = btoa('<style>p{color:red}</style><p>Hello &amp; welcome</p><script>x()</script>');
    const eml = `From: a@example.org\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n${html}\n`;
    const text = ((await read('m.eml', eml)) as { text: string }).text;
    expect(text).toContain('Hello & welcome');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('x()');
  });
});


const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const zipped = (files: Record<string, string | Uint8Array>) => {
  const z = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
};

describe('physics papers and manuscripts (15 Nov: "these are all grayed out")', () => {
  it('reads LaTeX, BibTeX and Wolfram source as text', async () => {
    expect(await extractText('regge.tex', bytes('\\section{Regge measure}\n$\\int D\\ell$'))).toEqual({ text: '\\section{Regge measure}\n$\\int D\\ell$' });
    expect(await extractText('refs.bib', bytes('@article{regge61, title={General relativity without coordinates}}'))).toEqual({ text: expect.stringContaining('regge61') });
    expect(await extractText('hessian.wl', bytes('h = D[f[x], {x, 2}]'))).toEqual({ text: 'h = D[f[x], {x, 2}]' });
  });

  it("reads a paper's .zip: each file with words under its own heading, the figures named as not read", async () => {
    const out = await extractText('Regge_Axial.zip', zipped({
      'paper/main.tex': '\\title{Axial Regge}\nThe measure is local.',
      'paper/refs.bib': '@book{misner}',
      'paper/fig1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      '__MACOSX/paper/._main.tex': 'junk',
    }));
    expect('text' in out).toBe(true);
    const text = (out as { text: string }).text;
    expect(text).toContain('### paper/main.tex');
    expect(text).toContain('The measure is local.');
    expect(text).toContain('### paper/refs.bib');
    expect(text).toContain('[Not read from Regge_Axial.zip: paper/fig1.png]');
    expect(text).not.toContain('junk');
  });

  it('says so when a .zip holds nothing with words', async () => {
    const out = await extractText('figs.zip', zipped({ 'a.png': new Uint8Array([1, 2]) }));
    expect(out).toEqual({ error: expect.stringContaining('could not be read') });
  });

  it('reads RTF without its control words or font tables', () => {
    const rtf = "{\\rtf1\\ansi{\\fonttbl{\\f0 Times;}}{\\*\\generator Word;}\\f0 Chapter One\\par It was caf\\'e9 time.\\par {\\b Bold} \\u8212? done}";
    expect(rtfText(rtf)).toBe('Chapter One\nIt was café time.\nBold — done');
  });

  it('reads HTML with its headings kept as # lines', () => {
    expect(htmlText('<html><head><title>x</title></head><body><h1>Part I</h1><p>First &amp; <b>last</b>.</p><script>no()</script></body></html>').trim())
      .toBe('# Part I\n\nFirst & last.');
  });

  it('reads an OpenDocument text file and an EPUB in reading order', async () => {
    const odt = await extractText('book.odt', zipped({
      'content.xml': '<office:document-content><office:body><text:h text:outline-level="1">Chapter 1</text:h><text:p>It began<text:s/>here.</text:p></office:body></office:document-content>',
    }));
    expect(odt).toEqual({ text: '# Chapter 1\n\nIt began here.' });
    const epub = await extractText('book.epub', zipped({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf': '<package><manifest><item id="c2" href="two.xhtml"/><item id="c1" href="one.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      'OEBPS/one.xhtml': '<html><body><h1>One</h1><p>First.</p></body></html>',
      'OEBPS/two.xhtml': '<html><body><h1>Two</h1><p>Second.</p></body></html>',
    }));
    expect(epub).toEqual({ text: '# One\n\nFirst.\n\n# Two\n\nSecond.' });
  });

  it('accepts the new types in the picker and reads a large document; old formats say what to do', () => {
    expect(isDocument('paper.tex')).toBe(true);
    expect(isDocument('source.zip')).toBe(true);
    expect(rejectReason('book.pdf', 30_000_000, [])).toBeNull();
    expect(rejectReason('book.pdf', 60_000_000, [])).toMatch(/larger than 50 MB/);
    expect(rejectReason('data.csv', 6_000_000, [])).toMatch(/larger than 5 MB/);
    expect(rejectReason('book.pages', 1_000, [])).toMatch(/Export To/);
    expect(rejectReason('book.doc', 1_000, [])).toMatch(/old Word format/);
  });

  it('never leaves half a math letter at the context limit', () => {
    const x = '\u{1D465}';
    // Whichever way the cut falls, odd or even, no half pair is left.
    for (let limit = 340; limit < 346; limit += 1) {
      const { context } = contextFromDocuments('', [{ name: 'paper.pdf', text: x.repeat(400) }], limit);
      expect(context.toWellFormed?.() ?? context).toBe(context);
      expect(JSON.stringify(context)).not.toMatch(/\\ud835(?!\\udc65)/);
      expect(context).toContain('the rest of paper.pdf was not added');
    }
  });

  it('drops NUL characters a PDF reader can produce', () => {
    expect(tidyText('a\u0000b')).toBe('ab');
  });
});
