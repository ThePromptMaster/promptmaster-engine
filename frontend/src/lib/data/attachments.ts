/**
 * Turning picked files into what a project stores, the same way wherever they
 * are picked — on the start screen, before the project exists, or on a stage.
 *
 * - A spreadsheet becomes one CSV per sheet.
 * - A document (PDF, Word, Markdown, text) keeps its file and has its words read
 *   out, for the project context.
 * - Anything else is checked and previewed as data.
 *
 * Images are not handled here: they wait for a caption before they are stored.
 */

import { contextFromDocuments, extractText, isDocument } from './extract-text';
import { MAX_FILE_BYTES, describePreview, isImage, isSpreadsheet, previewOf, rejectReason, type DataPreview } from './preview';
import { spreadsheetToCsvFiles } from './spreadsheet';

export interface PreparedFile {
  file: File;
  preview: DataPreview;
  /** A document's words, for the project context. */
  text?: string;
}

export interface Prepared {
  ready: PreparedFile[];
  errors: string[];
  notes: string[];
}

export async function prepareFiles(picked: readonly File[], existing: readonly string[]): Promise<Prepared> {
  const out: Prepared = { ready: [], errors: [], notes: [] };
  const names = [...existing];
  for (const original of picked) {
    if (isImage(original.name)) {
      out.errors.push(`${original.name} is an image — add it with "Add images" so it gets a caption.`);
      continue;
    }
    let parts = [original];
    if (isSpreadsheet(original.name)) {
      if (original.size > MAX_FILE_BYTES) {
        out.errors.push(`${original.name} is larger than ${MAX_FILE_BYTES / 1_000_000} MB.`);
        continue;
      }
      try {
        parts = await spreadsheetToCsvFiles(original);
      } catch {
        out.errors.push(`${original.name} could not be read as a spreadsheet. Save it as CSV and attach that.`);
        continue;
      }
      if (!parts.length) {
        out.errors.push(`${original.name} has no sheet with anything in it.`);
        continue;
      }
      out.notes.push(
        `${original.name} was converted to CSV — ${parts.length === 1 ? 'one file' : `${parts.length} files, one per sheet`}. ` +
          'Values are kept; formulas arrive as their results, and formatting and charts are left behind.'
      );
    }
    for (const file of parts) {
      const reason = rejectReason(file.name, file.size, names);
      if (reason) {
        out.errors.push(reason);
        continue;
      }
      if (isDocument(file.name)) {
        const read = await extractText(file.name, await file.arrayBuffer());
        if ('error' in read) {
          out.errors.push(read.error);
          continue;
        }
        out.ready.push({ file, preview: previewOf(file.name, read.text), text: read.text });
      } else {
        out.ready.push({ file, preview: previewOf(file.name, await file.text()) });
      }
      names.push(file.name);
    }
  }
  return out;
}

/** The documents among prepared files, as `{ name, text }`. */
export function documentsOf(files: readonly PreparedFile[]): { name: string; text: string }[] {
  return files.flatMap((f) => (f.text ? [{ name: f.file.name, text: f.text }] : []));
}

/**
 * What the setup calls are told was attached: each document's words, then one
 * line per data file. The calls read only the opening of it (setup_suggester.py).
 */
export function materialFrom(files: readonly PreparedFile[], limit: number): string {
  const data = files.filter((f) => !f.text).map((f) => `- ${f.file.name}: ${describePreview(f.preview)}`);
  const docs = contextFromDocuments('', documentsOf(files), limit).context;
  return [docs, data.length ? `Data files attached:\n${data.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
