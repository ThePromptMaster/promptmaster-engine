/**
 * The words in a brief someone attached (5 Oct, email 8: "should we put the
 * attachment stuff in the beginning screen so it recognizes it when creating
 * prompt?").
 *
 * A data file is shown to a model as its columns and first rows; a document is
 * not data, it is the brief itself, so its text goes into the project context
 * where every stage can quote it. Read in the browser — nothing is sent
 * anywhere to be converted — and the parsers are loaded only when a document
 * is attached.
 */

import { installPdfShims } from './browser-shims';
import { emlText, icsText } from './mail-text';
import { extensionOf } from './preview';
import { tr } from '@/lib/i18n/store';

/** Attachments whose words, not rows, are what matters. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.md', '.txt', '.ics', '.eml'] as const;

export function isDocument(name: string): boolean {
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

async function pdfText(data: ArrayBuffer): Promise<string> {
  // Safari (iPhone included) cannot iterate a stream; pdfjs does (22 Oct).
  installPdfShims();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function docxText(data: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  // The browser build reads `arrayBuffer`, the Node build (the tests) `buffer`;
  // each ignores the other's key, and a bundler may define Buffer in the browser.
  const input = typeof Buffer === 'undefined' ? { arrayBuffer: data } : { arrayBuffer: data, buffer: Buffer.from(data) };
  const { value } = await mammoth.extractRawText(input as Parameters<typeof mammoth.extractRawText>[0]);
  return value;
}

/** A deck longer than this is read to here; a slide's XML larger than this is not a slide of words. */
const MAX_SLIDES = 300;
const MAX_PART_BYTES = 2_000_000;
const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return XML_ENTITY[name.toLowerCase()] ?? whole;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** The paragraphs of one slide, in the order the file holds them. */
function slideParagraphs(xml: string): string[] {
  const out: string[] = [];
  for (const p of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const line = [...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>|<a:tab\b[^>]*\/>/g)]
      .map((m) => (m[1] !== undefined ? xmlText(m[1]) : m[0].startsWith('<a:br') ? '\n' : ' '))
      .join('')
      .trim();
    if (line) out.push(line);
  }
  return out;
}

/**
 * The words on a deck's slides, in the deck's order (12 Nov, a client: "Can we
 * hook this up to … Office?"). What someone presenting it shows: hidden slides
 * and speaker notes are left out, as a model is given what a person sees. Read
 * as text only; nothing in the file is resolved or followed.
 */
async function pptxText(data: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const wanted = /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/;
  const files = unzipSync(new Uint8Array(data), { filter: (f) => wanted.test(f.name) && f.originalSize <= MAX_PART_BYTES });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const slides = Object.keys(files).filter((n) => n.startsWith('ppt/slides/'));
  if (!slides.length) throw new Error('it holds no slides');
  // The deck's own order: presentation.xml lists relationship ids, the rels file says which slide each is.
  const target = new Map<string, string>();
  for (const rel of read('ppt/_rels/presentation.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
    const to = /\bTarget="\/?(?:ppt\/)?(slides\/slide\d+\.xml)"/.exec(rel[0])?.[1];
    if (id && to) target.set(id, `ppt/${to}`);
  }
  const listed = [...read('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => target.get(m[1]))
    .filter((n): n is string => Boolean(n && files[n]));
  const number = (n: string) => Number(/slide(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  const order = listed.length ? listed : [...slides].sort((a, b) => number(a) - number(b));
  const parts: string[] = [];
  order.slice(0, MAX_SLIDES).forEach((name, i) => {
    const xml = read(name);
    if (/<p:sld\b[^>]*\bshow="(?:0|false)"/.test(xml)) return;
    const lines = slideParagraphs(xml);
    if (lines.length) parts.push(`Slide ${i + 1}\n${lines.join('\n')}`);
  });
  return parts.join('\n\n');
}

/** A zip (every Office file is one) or anything holding NULs is not text, whatever it is called. */
function notText(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data.slice(0, 4096));
  return (head[0] === 0x50 && head[1] === 0x4b) || head.includes(0);
}

/** Collapse the blank lines and trailing spaces document converters leave behind. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Text as it is. Until 13 Nov anything this file had no reader for was decoded
 * as text, so a spreadsheet or a deck handed over from Drive or OneDrive came
 * back as its zip's bytes and was sent on as if it were words.
 */
function plainText(data: ArrayBuffer): string {
  if (notText(data)) throw new Error('it is not a text file');
  return new TextDecoder().decode(data);
}

/**
 * The text of a document, or a sentence saying why it has none. A scanned PDF
 * has pages but no words; that is said rather than attached as an empty brief.
 */
export async function extractText(name: string, data: ArrayBuffer): Promise<{ text: string } | { error: string }> {
  const ext = extensionOf(name);
  try {
    const raw =
      ext === '.pdf'
        ? await pdfText(data)
        : ext === '.docx'
          ? await docxText(data)
          : ext === '.xlsx'
            ? await (await import('./spreadsheet')).spreadsheetToText(data)
            : ext === '.pptx'
              ? await pptxText(data)
              : ext === '.ics'
                ? icsText(new TextDecoder().decode(data))
                : ext === '.eml'
                  ? emlText(new TextDecoder().decode(data))
                  : plainText(data);
    const text = tidyText(raw);
    if (!text) {
      return {
        error:
          ext === '.pdf' ? tr('file.noTextPdf', { name }) : tr('file.noText', { name }),
      };
    }
    return { text };
  } catch (e) {
    // The reason is kept: a generic "could not be read" hid what actually
    // failed, which made a broken reader look like a bad file.
    const why = e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : '';
    if (typeof console !== 'undefined') console.warn('[extract-text]', name, e);
    return {
      error: tr('file.unreadable', { name, why }),
    };
  }
}

/** The documents' text as project context, one heading per file, within `limit`. */
export function contextFromDocuments(
  existing: string,
  documents: readonly { name: string; text: string }[],
  limit: number
): { context: string; cut: string[] } {
  let context = existing.trim();
  const cut: string[] = [];
  for (const doc of documents) {
    const block = `### From ${doc.name}\n\n${doc.text}`;
    const joined = context ? `${context}\n\n${block}` : block;
    if (joined.length <= limit) {
      context = joined;
      continue;
    }
    const room = limit - (context ? context.length + 2 : 0);
    const note = `\n\n[…the rest of ${doc.name} was not added: the project context holds ${limit.toLocaleString('en-US')} characters]`;
    if (room > note.length + 200) context = `${context ? `${context}\n\n` : ''}${block.slice(0, room - note.length)}${note}`;
    cut.push(doc.name);
  }
  return { context, cut };
}
