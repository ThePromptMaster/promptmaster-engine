/**
 * A spreadsheet attached as data becomes one CSV per sheet, in the browser.
 *
 * The preview shown to the model, the sandbox that runs code against the
 * file and the person reading the Data panel then all see the same thing: a
 * table with a header row. Formulas arrive as their last computed values;
 * formatting, charts and merged cells do not arrive at all, and the panel
 * says so. The workbook itself is never stored.
 */

export type Cell = string | number | boolean | Date | null | undefined;

const DAY_MS = 86_400_000;

function cellText(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    // A date with no time of day is written as a date.
    return value.getTime() % DAY_MS === 0 ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  return String(value);
}

function quote(text: string): string {
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of cells as CSV. Rows that are empty to the end are dropped; every row is as wide as the widest. */
export function sheetToCsv(rows: readonly (readonly Cell[])[]): string {
  const text = rows.map((row) => row.map(cellText));
  while (text.length && text[text.length - 1].every((c) => !c.trim())) text.pop();
  const width = text.reduce((w, row) => Math.max(w, row.length), 0);
  return text.map((row) => Array.from({ length: width }, (_, i) => quote(row[i] ?? '')).join(',')).join('\n') + (text.length ? '\n' : '');
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');
const safe = (sheet: string) => sheet.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';

/** The CSV names for a workbook's sheets: `accounts.csv` for one, `accounts - Q1.csv` for several. */
export function csvNamesFor(fileName: string, sheetNames: readonly string[]): string[] {
  if (sheetNames.length <= 1) return sheetNames.map(() => `${stem(fileName)}.csv`);
  const seen = new Map<string, number>();
  return sheetNames.map((sheet) => {
    const base = `${stem(fileName)} - ${safe(sheet)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}${n > 1 ? ` (${n})` : ''}.csv`;
  });
}

export interface ConvertedSheet {
  name: string;
  csv: string;
}

/** Sheets as CSV files, skipping sheets with nothing in them. */
export function sheetsToCsv(fileName: string, sheets: readonly { sheet: string; data: readonly (readonly Cell[])[] }[]): ConvertedSheet[] {
  const filled = sheets.map((s) => ({ sheet: s.sheet, csv: sheetToCsv(s.data) })).filter((s) => s.csv.trim());
  const names = csvNamesFor(fileName, filled.map((s) => s.sheet));
  return filled.map((s, i) => ({ name: names[i], csv: s.csv }));
}

/** Read an .xlsx in the browser. The reader is loaded only when a spreadsheet is attached. */
export async function spreadsheetToCsvFiles(file: File): Promise<File[]> {
  const { default: readExcelFile } = await import('read-excel-file/browser');
  const sheets = (await readExcelFile(file)) as unknown as { sheet: string; data: Cell[][] }[];
  return sheetsToCsv(file.name, sheets).map((s) => new File([s.csv], s.name, { type: 'text/csv' }));
}
