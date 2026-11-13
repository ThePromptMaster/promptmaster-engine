/**
 * The work's tables as an Excel workbook (12 Nov, a client: "Can we hook this
 * up to … Excel?").
 *
 * Client-side, like the Word and PowerPoint exports, with the library loaded
 * only when the button is pressed. Each table in the Markdown the app already
 * assembles becomes a sheet, named after the heading it sits under. A document
 * with no table has nothing to put in a workbook, so the button is not offered.
 *
 * What a cell holds is what the table says: a cell is a number only when the
 * whole of it is one, so "1,200", "12%" and "007" stay as written; nothing is
 * ever written as a formula, whatever it starts with.
 */

import { tablesIn } from './markdown-tables';

export interface WorkbookSheet {
  name: string;
  /** The header row first. */
  rows: (string | number)[][];
}

const SHEET_NAME_MAX = 31;
const COLUMN_MIN = 8;
const COLUMN_MAX = 60;
/** Sixteen digits and more do not survive as a number. */
const WHOLE_NUMBER = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,10})?$/;

/** The cell as Excel should hold it: a number only if the whole cell is one. */
export function cellValue(text: string): string | number {
  const value = text.trim();
  return WHOLE_NUMBER.test(value) ? Number(value) : value;
}

/** Names Excel accepts: none of \ / ? * [ ] :, at most 31 characters, not blank, none used twice. */
export function sheetNames(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  return titles.map((title, i) => {
    const base = title.replace(/[\\/?*[\]:]+/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim() || `Table ${i + 1}`;
    let name = base.slice(0, SHEET_NAME_MAX).trim();
    for (let n = 2; seen.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, SHEET_NAME_MAX - suffix.length).trim()}${suffix}`;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

/** The sheets a document's tables make, or none. Pure. */
export function workbookFrom(markdown: string): WorkbookSheet[] {
  const tables = tablesIn(markdown).filter((t) => t.rows.length > 0 && t.rows[0].some((c) => c.trim()));
  const names = sheetNames(tables.map((t) => t.title));
  return tables.map((t, i) => ({
    name: names[i],
    rows: t.rows.map((row, r) => row.map((cell) => (r === 0 ? cell.trim() : cellValue(cell)))),
  }));
}

/** One table given as rows (the assessment table), as a workbook of one sheet. */
export function sheetFrom(name: string, rows: readonly (readonly string[])[]): WorkbookSheet[] {
  return [{ name: sheetNames([name])[0], rows: rows.map((row, r) => row.map((cell) => (r === 0 ? cell : cellValue(cell)))) }];
}

function widths(rows: WorkbookSheet['rows']): { width: number }[] {
  const count = rows.reduce((w, row) => Math.max(w, row.length), 0);
  return Array.from({ length: count }, (_, c) => ({
    width: Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, ...rows.map((row) => String(row[c] ?? '').length + 2))),
  }));
}

/** The workbook as an .xlsx file. */
export async function workbookToXlsx(sheets: readonly WorkbookSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  return writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheet.name,
      columns: widths(sheet.rows),
      stickyRowsCount: 1,
      data: sheet.rows.map((row, r) =>
        row.map((value) =>
          typeof value === 'number'
            ? { value, type: Number }
            : { value, type: String, ...(r === 0 ? { fontWeight: 'bold' as const } : {}), wrap: value.length > COLUMN_MAX }
        )
      ),
    }))
  ).toBlob();
}
