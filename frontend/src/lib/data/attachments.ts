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
import { tr } from '@/lib/i18n/store';

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
      out.errors.push(tr('file.isImage', { name: original.name }));
      continue;
    }
    let parts = [original];
    if (isSpreadsheet(original.name)) {
      if (original.size > MAX_FILE_BYTES) {
        out.errors.push(tr('file.tooLarge', { name: original.name, mb: MAX_FILE_BYTES / 1_000_000 }));
        continue;
      }
      try {
        parts = await spreadsheetToCsvFiles(original);
      } catch {
        out.errors.push(tr('file.notSpreadsheet', { name: original.name }));
        continue;
      }
      if (!parts.length) {
        out.errors.push(tr('file.noSheet', { name: original.name }));
        continue;
      }
      out.notes.push(parts.length === 1 ? tr('file.convertedOne', { name: original.name }) : tr('file.convertedMany', { name: original.name, n: parts.length }));
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
  const lines = data.length ? `Data files attached:\n${data.join('\n')}` : '';
  // Room is kept for the data files: a long document filled the limit, and these
  // lines tipped it over, so the request was refused (5 Nov).
  const docs = contextFromDocuments('', documentsOf(files), Math.max(0, limit - (lines ? lines.length + 2 : 0))).context;
  return [docs, lines].filter(Boolean).join('\n\n');
}

const MATERIAL_CUT = '\n\n[…the rest of the material was not sent: it is still in the project]';

/**
 * What was said first, then what was attached, within `limit` (5 Nov, a book
 * attached to a conversation). The two were joined with no limit, so a long document
 * that fit on its own was refused once there was any conversation beside it: "`material`
 * is longer than the 200,000-character limit". And setup reads only the opening, so
 * with the document first it never read the conversation at all.
 */
export function setupMaterial(said: string, attached: string, limit: number): string {
  const joined = [said.trim(), attached.trim()].filter(Boolean).join('\n\n');
  return joined.length <= limit ? joined : `${joined.slice(0, Math.max(0, limit - MATERIAL_CUT.length))}${MATERIAL_CUT}`;
}

/** Attached documents too long for a project to hold whole, by name (5 Nov): said, not silently cut. */
export function documentsCut(files: readonly PreparedFile[], limit: number): string[] {
  return contextFromDocuments('', documentsOf(files), limit).cut;
}

/** A file attached to one side-chat message, as the request carries it (5 Nov). */
export interface MessageAttachment {
  name: string;
  text?: string;
  /** An image as a data URL, already scaled down. */
  image?: string;
  /** Saved in the project, but more than this message can carry: named, so the reply can say so. */
  not_read?: boolean;
}

/** A document's words carried with a message. A longer one is cut, with a note. */
export const MESSAGE_TEXT_MAX = 60_000;
/** What a message can carry in all: a request is refused at about 4.5 MB, and the project's own text comes too. */
export const MESSAGE_ATTACHMENTS_MAX = 3_000_000;

/**
 * What one message can carry, in the order attached. What does not fit stays named,
 * so the reply can say it was not read: eleven phone screenshots are more than one
 * message holds.
 */
export function withinMessage(items: readonly MessageAttachment[], max = MESSAGE_ATTACHMENTS_MAX): MessageAttachment[] {
  let used = 0;
  return items.map((item) => {
    const text = item.text && item.text.length > MESSAGE_TEXT_MAX ? `${item.text.slice(0, MESSAGE_TEXT_MAX)}\n[…the rest of this document was not sent with the message]` : item.text;
    const size = (item.image?.length ?? 0) + (text?.length ?? 0);
    if (used + size > max) return { name: item.name, not_read: true };
    used += size;
    return { ...item, ...(text !== undefined ? { text } : {}) };
  });
}
