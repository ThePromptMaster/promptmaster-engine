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

import { extensionOf } from './preview';

/** Attachments whose words, not rows, are what matters. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.md', '.txt'] as const;

export function isDocument(name: string): boolean {
  return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

async function pdfText(data: ArrayBuffer): Promise<string> {
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
 * The text of a document, or a sentence saying why it has none. A scanned PDF
 * has pages but no words; that is said rather than attached as an empty brief.
 */
export async function extractText(name: string, data: ArrayBuffer): Promise<{ text: string } | { error: string }> {
  const ext = extensionOf(name);
  try {
    const raw =
      ext === '.pdf' ? await pdfText(data) : ext === '.docx' ? await docxText(data) : new TextDecoder().decode(data);
    const text = tidyText(raw);
    if (!text) {
      return {
        error:
          ext === '.pdf'
            ? `${name} has no text to read — it may be a scanned image. Paste its words instead.`
            : `${name} has no text in it.`,
      };
    }
    return { text };
  } catch (e) {
    // The reason is kept: a generic "could not be read" hid what actually
    // failed, which made a broken reader look like a bad file.
    const why = e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : '';
    if (typeof console !== 'undefined') console.warn('[extract-text]', name, e);
    return {
      error: `${name} could not be read${why}. Save it again as PDF or Word (.docx), or paste its words instead.`,
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
