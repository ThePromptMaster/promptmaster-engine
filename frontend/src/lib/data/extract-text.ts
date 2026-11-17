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
import { cutText, storableText } from './clean-text';
import { emlText, icsText } from './mail-text';
import { DOCUMENT_EXTENSIONS, extensionOf, isDocument } from './preview';
import { tr } from '@/lib/i18n/store';

/** Attachments whose words, not rows, are what matters (the list lives in preview.ts, beside the size limits). */
export { DOCUMENT_EXTENSIONS, isDocument };

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
  // As HTML first, so the document's headings are kept as "#" lines (15 Nov): a
  // manuscript's chapters are found by them, and passages are matched under them.
  try {
    const { value } = await mammoth.convertToHtml(input as Parameters<typeof mammoth.convertToHtml>[0]);
    const text = htmlText(value);
    if (text.trim()) return text;
  } catch {
    // Read as plain text below.
  }
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

/** HTML (or XHTML) as plain text: headings kept as "#" lines, scripts and styles left out. */
export function htmlText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return xmlText(
    body
      .replace(/<(script|style|head|nav)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) =>
        `\n\n${'#'.repeat(Math.min(Number(level), 3))} ${inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}\n\n`)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|blockquote|section|article|table|ul|ol)>/gi, '\n\n')
      .replace(/<(td|th)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Groups in an RTF file that hold no words of the document. */
const RTF_SKIP = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'generator', 'filetbl', 'revtbl',
]);
const RTF_CHAR: Record<string, string> = {
  par: '\n', line: '\n', sect: '\n\n', page: '\n\n', tab: '\t', cell: ' ', row: '\n',
  emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', '~': ' ',
};

/** The words of an RTF document: control words and groups that hold no text are dropped. */
export function rtfText(raw: string): string {
  if (!raw.startsWith('{\\rtf')) throw new Error('it is not an RTF file');
  const cp1252 = new TextDecoder('windows-1252');
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let fallback = 0;
  let atGroupStart = false;
  let out = '';
  const emit = (s: string) => {
    if (fallback > 0) {
      fallback -= 1;
      return;
    }
    if (!skip) out += s;
  };
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '{') {
      stack.push({ skip, uc });
      atGroupStart = true;
      continue;
    }
    if (ch === '}') {
      const prior = stack.pop();
      if (prior) ({ skip, uc } = prior);
      atGroupStart = false;
      continue;
    }
    if (ch === '\r' || ch === '\n') continue;
    if (ch !== '\\') {
      atGroupStart = false;
      emit(ch);
      continue;
    }
    const next = raw[i + 1];
    if (next === '\\' || next === '{' || next === '}') {
      emit(next);
      i += 1;
      atGroupStart = false;
      continue;
    }
    if (next === "'") {
      const code = parseInt(raw.slice(i + 2, i + 4), 16);
      if (Number.isFinite(code)) emit(cp1252.decode(new Uint8Array([code])));
      i += 3;
      atGroupStart = false;
      continue;
    }
    if (next === '*') {
      if (atGroupStart) skip = true;
      i += 1;
      continue;
    }
    const word = /^([a-zA-Z]+)(-?\d+)? ?/.exec(raw.slice(i + 1, i + 40));
    if (!word) {
      if (next === '~') emit(' ');
      i += 1;
      continue;
    }
    i += word[0].length;
    const name = word[1];
    if (atGroupStart && RTF_SKIP.has(name)) skip = true;
    atGroupStart = false;
    if (name === 'uc' && word[2]) uc = Number(word[2]);
    else if (name === 'u' && word[2]) {
      const n = Number(word[2]);
      emit(String.fromCharCode(n < 0 ? n + 65536 : n));
      fallback = uc;
    } else if (RTF_CHAR[name] !== undefined) emit(RTF_CHAR[name]);
  }
  return out;
}

/** An OpenDocument text file (.odt): its paragraphs and headings, in order. */
async function odtText(data: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(data), { filter: (f) => f.name === 'content.xml' });
  const xml = files['content.xml'] ? strFromU8(files['content.xml']) : '';
  if (!xml) throw new Error('it holds no text part');
  return xmlText(
    xml
      .replace(/<text:h\b[^>]*>([\s\S]*?)<\/text:h>/g, (_m, inner: string) => `\n\n# ${inner.replace(/<[^>]+>/g, '')}\n\n`)
      .replace(/<text:tab\s*\/>/g, '\t')
      .replace(/<text:line-break\s*\/>/g, '\n')
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_m, n?: string) => ' '.repeat(n ? Number(n) : 1))
      .replace(/<\/text:p>/g, '\n\n')
      .replace(/<[^>]+>/g, '')
  );
}

/** An e-book (.epub): each chapter's text in reading order. */
async function epubText(data: ArrayBuffer): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(data), { filter: (f) => f.originalSize <= MAX_PART_BYTES * 10 });
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const opfPath = /full-path="([^"]+)"/.exec(read('META-INF/container.xml'))?.[1] ?? Object.keys(files).find((n) => n.endsWith('.opf')) ?? '';
  const opf = read(opfPath);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const href = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(item[0])?.[1];
    const to = /\bhref="([^"]+)"/.exec(item[0])?.[1];
    if (!id || !to) continue;
    let path = to;
    try {
      path = decodeURIComponent(to);
    } catch {
      // A malformed escape: the name as written.
    }
    href.set(id, base + path);
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => href.get(m[1])).filter((n): n is string => Boolean(n && files[n]));
  const order = spine.length ? spine : Object.keys(files).filter((n) => /\.x?html?$/i.test(n)).sort();
  if (!order.length) throw new Error('it holds no chapters');
  return order.map((name) => htmlText(read(name)).trim()).filter(Boolean).join('\n\n');
}

/** What a .zip's files are read as: words, by the reader for their type. */
const ZIP_TEXT = new Set(['.tex', '.bib', '.md', '.txt', '.wl', '.m', '.nb', '.bbl', '.csv', '.tsv', '.json']);
const ZIP_DOCUMENT = new Set(['.pdf', '.docx', '.pptx', '.odt', '.epub', '.rtf', '.html', '.htm']);
const ZIP_MAX_ENTRIES = 300;
const ZIP_MAX_PART = 20_000_000;

/**
 * The words in a .zip (15 Nov: a physics paper's source comes as one — the
 * .tex, the .bib and the figures). Each file that holds words is read by the
 * reader for its type, under its own heading; what has none (figures, fonts,
 * compiled output) is named as not read. A zip inside the zip is not opened.
 */
async function zipText(data: ArrayBuffer, name: string): Promise<string> {
  const { unzipSync } = await import('fflate');
  const wanted = (n: string) =>
    !n.endsWith('/') && !n.startsWith('__MACOSX/') && !n.split('/').some((part) => part.startsWith('.'));
  let seen = 0;
  const skipped: string[] = [];
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => {
      if (!wanted(f.name)) return false;
      const ext = extensionOf(f.name);
      if (!ZIP_TEXT.has(ext) && !ZIP_DOCUMENT.has(ext)) {
        skipped.push(f.name);
        return false;
      }
      if (f.originalSize > ZIP_MAX_PART || seen >= ZIP_MAX_ENTRIES) {
        skipped.push(f.name);
        return false;
      }
      seen += 1;
      return true;
    },
  });
  const parts: string[] = [];
  for (const entry of Object.keys(files).sort()) {
    const ext = extensionOf(entry);
    const bytes = files[entry];
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    let text = '';
    try {
      text = ZIP_TEXT.has(ext) ? plainText(buffer) : await readerFor(ext, buffer);
    } catch {
      skipped.push(entry);
      continue;
    }
    if (text.trim()) parts.push(`### ${entry}\n\n${text.trim()}`);
    else skipped.push(entry);
  }
  if (!parts.length) throw new Error('nothing in it holds text');
  if (skipped.length) {
    const shown = skipped.slice(0, 12).join(', ');
    parts.push(`[Not read from ${name}: ${shown}${skipped.length > 12 ? ` and ${skipped.length - 12} more` : ''}]`);
  }
  return parts.join('\n\n');
}

/** A zip (every Office file is one) or anything holding NULs is not text, whatever it is called. */
function notText(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data.slice(0, 4096));
  return (head[0] === 0x50 && head[1] === 0x4b) || head.includes(0);
}

/**
 * Collapse the blank lines and trailing spaces document converters leave behind,
 * and drop what the database refuses (`clean-text.ts`, 15 Nov).
 */
export function tidyText(text: string): string {
  return storableText(text)
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

/** The reader for one file type; anything without its own is read as plain text. */
async function readerFor(ext: string, data: ArrayBuffer): Promise<string> {
  switch (ext) {
    case '.pdf': return pdfText(data);
    case '.docx': return docxText(data);
    case '.xlsx': return (await import('./spreadsheet')).spreadsheetToText(data);
    case '.pptx': return pptxText(data);
    case '.odt': return odtText(data);
    case '.epub': return epubText(data);
    case '.rtf': return rtfText(plainText(data));
    case '.html':
    case '.htm': return htmlText(plainText(data));
    case '.ics': return icsText(new TextDecoder().decode(data));
    case '.eml': return emlText(new TextDecoder().decode(data));
    default:
      return plainText(data);
  }
}

/**
 * The text of a document, or a sentence saying why it has none. A scanned PDF
 * has pages but no words; that is said rather than attached as an empty brief.
 */
export async function extractText(name: string, data: ArrayBuffer): Promise<{ text: string } | { error: string }> {
  const ext = extensionOf(name);
  try {
    const raw = ext === '.zip' ? await zipText(data, name) : await readerFor(ext, data);
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
    if (room > note.length + 200) context = `${context ? `${context}\n\n` : ''}${cutText(block, room - note.length)}${note}`;
    cut.push(doc.name);
  }
  return { context, cut };
}

/**
 * A document's words swapped for its new version's, where the context holds them under
 * "### From <name>" (17 Nov, Sean: "When a source changes, I want PromptMaster to carry it
 * through the affected drafts, show what changed, and ask me when it actually needs my
 * judgment"). Null when the context holds no block for it. Pure.
 */
export function replaceDocumentInContext(context: string, name: string, text: string): string | null {
  const heading = `### From ${name}\n\n`;
  const at = context.indexOf(heading);
  if (at < 0) return null;
  const next = context.indexOf('\n\n### From ', at + heading.length);
  const end = next < 0 ? context.length : next;
  return `${context.slice(0, at)}${heading}${text.trim()}${context.slice(end)}`;
}
