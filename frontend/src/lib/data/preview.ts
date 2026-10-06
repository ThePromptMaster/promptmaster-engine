/**
 * What a data file holds, worked out in the browser when it is attached. Pure.
 *
 * This is all a model is ever shown of the file: its column names, its first
 * few rows and how many rows there are. That is enough to write code against
 * it; the file itself goes only to the sandbox that runs that code.
 */

export const MAX_FILE_BYTES = 5_000_000;
export const MAX_FILES = 20;
export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.json', '.txt'] as const;
/**
 * Briefs and reports (5 Oct, email 8). Their text is read in the browser
 * (lib/data/extract-text.ts) and offered as project context; the file itself
 * is kept like any other.
 */
export const DOCUMENT_ONLY_EXTENSIONS = ['.pdf', '.docx', '.md'] as const;
/**
 * Photos and figures (3 Oct call: "attachments, pictures, photos"). They are
 * placed in the work, never shown to a model: a prompt gets each one's name,
 * caption and id, so it can say where it belongs.
 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

export function isImage(name: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}
/** Converted to CSV in the browser when attached (lib/data/spreadsheet.ts); never stored as it is. */
export const SPREADSHEET_EXTENSION = '.xlsx';
/** What the file picker offers. */
export const PICKABLE_EXTENSIONS = [...ACCEPTED_EXTENSIONS, ...DOCUMENT_ONLY_EXTENSIONS, SPREADSHEET_EXTENSION, ...IMAGE_EXTENSIONS] as const;

export function isSpreadsheet(name: string): boolean {
  return extensionOf(name) === SPREADSHEET_EXTENSION;
}
const SAMPLE_ROWS = 5;
const MAX_COLUMNS = 60;
const CELL_MAX = 80;

export interface DataPreview {
  kind: 'table' | 'json' | 'text' | 'image';
  /** Images only: what the user says it shows, used as its alt text and by prompts. */
  caption?: string;
  width?: number;
  height?: number;
  /** Column names (table), top-level keys (json). */
  columns: string[];
  /** The first rows, each cell clipped. */
  sample: string[][];
  /** Data rows, not counting the header (table); array length (json); lines (text). */
  rows: number;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** Why a file cannot be attached, or null when it can. */
export function rejectReason(name: string, bytes: number, existing: readonly string[]): string | null {
  const ext = extensionOf(name);
  if (
    !(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext) &&
    !(DOCUMENT_ONLY_EXTENSIONS as readonly string[]).includes(ext) &&
    !isImage(name)
  ) {
    return ext === '.xls'
      ? `${name} is in the old Excel format. Save it as .xlsx or CSV first.`
      : ext === '.doc'
        ? `${name} is in the old Word format. Save it as .docx or PDF first.`
        : `${name} is not a PDF, Word (.docx), Markdown, text, spreadsheet (.xlsx), CSV, TSV, JSON or image (PNG, JPEG, WebP, GIF) file.`;
  }
  if (bytes > MAX_FILE_BYTES) return `${name} is larger than ${MAX_FILE_BYTES / 1_000_000} MB.`;
  if (bytes === 0) return `${name} is empty.`;
  if (existing.includes(name)) return `A file called ${name} is already attached. Remove it first to replace it.`;
  if (existing.length >= MAX_FILES) return `A project can hold ${MAX_FILES} files.`;
  return null;
}

/** One delimited line into cells, honouring double-quoted cells. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const clip = (value: string) => (value.length > CELL_MAX ? `${value.slice(0, CELL_MAX - 1)}…` : value);

export function previewOf(name: string, text: string): DataPreview {
  const ext = extensionOf(name);
  if (ext === '.json') {
    try {
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : null;
      const first = list ? list[0] : parsed;
      const columns = first && typeof first === 'object' ? Object.keys(first as object).slice(0, MAX_COLUMNS) : [];
      const sample = (list ?? [parsed]).slice(0, SAMPLE_ROWS).map((row) =>
        columns.map((c) => clip(String((row as Record<string, unknown>)?.[c] ?? '')))
      );
      return { kind: 'json', columns, sample, rows: list ? list.length : 1 };
    } catch {
      // Not valid JSON: described as text, and the code that reads it will say so.
    }
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (ext === '.csv' || ext === '.tsv') {
    const delimiter = ext === '.tsv' ? '\t' : ',';
    const columns = splitLine(lines[0] ?? '', delimiter).slice(0, MAX_COLUMNS);
    const sample = lines.slice(1, 1 + SAMPLE_ROWS).map((l) => splitLine(l, delimiter).slice(0, MAX_COLUMNS).map(clip));
    return { kind: 'table', columns, sample, rows: Math.max(0, lines.length - 1) };
  }
  return { kind: 'text', columns: [], sample: lines.slice(0, SAMPLE_ROWS).map((l) => [clip(l)]), rows: lines.length };
}

/** An image's record. The caption defaults to the file's name without its extension. */
export function imagePreview(name: string, caption: string, width = 0, height = 0): DataPreview {
  const fallback = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return { kind: 'image', columns: [], sample: [], rows: 0, caption: (caption.trim() || fallback).slice(0, 200), width, height };
}

/** One line a person reads: "1,204 rows · account_id, plan, churned…". */
export function describePreview(preview: DataPreview): string {
  if (preview.kind === 'image') {
    const size = preview.width && preview.height ? ` · ${preview.width}×${preview.height}` : '';
    return `image${size}${preview.caption ? ` · ${preview.caption}` : ''}`;
  }
  const count = `${preview.rows.toLocaleString()} ${preview.kind === 'text' ? 'line' : 'row'}${preview.rows === 1 ? '' : 's'}`;
  if (!preview.columns.length) return count;
  const shown = preview.columns.slice(0, 6).join(', ');
  return `${count} · ${shown}${preview.columns.length > 6 ? `, +${preview.columns.length - 6} more` : ''}`;
}
