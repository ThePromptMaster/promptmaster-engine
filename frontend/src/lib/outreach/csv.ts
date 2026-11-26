/**
 * Reading a pasted or uploaded contact list as a table (Sean, 26 Nov: "Let me paste a list,
 * upload a CSV from Clay, or start with company names and websites").
 *
 * A full RFC 4180 reader, because what comes in is rarely clean: a semicolon file from a
 * European Excel, a tab-separated paste from Sheets, a cell with a line break in it, a header
 * written twice, a row that stops early. Nothing here guesses what a column means; that is
 * `import.ts`.
 */

export type Delimiter = ',' | ';' | '\t';

/** One import is a list to work through by hand, not a database: past this, say it was cut. */
export const MAX_ROWS = 2000;
export const MAX_COLUMNS = 60;

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: Delimiter;
  /** More rows than MAX_ROWS, or more columns than MAX_COLUMNS, were left out. */
  truncated: boolean;
}

/** How many records the delimiter is judged on. */
const SNIFF_RECORDS = 20;

/** Tried in this order, and a tie goes to the earlier: a tab or a semicolon that splits every
 * line the same way is meant, while a comma turns up in ordinary text ("Smith, John"). */
const DELIMITERS: readonly Delimiter[] = ['\t', ';', ','];

/** BOM off, every line end made "\n" (also inside quoted cells, so a cell reads the same from
 * Windows and Mac exports). */
function normalize(text: string): string {
  return (text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/**
 * The records of `text` split on `d`, at most `limit` of them; `more` says another non-empty
 * record followed. A blank line, or one whose cells are all empty (",,,," from Excel), is not a
 * record. Unquoted cells are trimmed; a quoted cell keeps its content exactly, with only the
 * spaces outside its quotes dropped.
 */
function readRecords(text: string, d: Delimiter, limit: number): { records: string[][]; more: boolean } {
  const records: string[][] = [];
  const n = text.length;
  let record: string[] = [];
  let i = 0;
  let more = false;

  const endRecord = (): boolean => {
    const empty = record.every((c) => c === '');
    if (!empty) {
      if (records.length >= limit) {
        more = true;
        return true;
      }
      records.push(record);
    }
    record = [];
    return false;
  };

  while (i < n) {
    let j = i;
    while (j < n && (text[j] === ' ' || (text[j] === '\t' && d !== '\t'))) j++;
    let value: string;
    if (text[j] === '"') {
      j++;
      let content = '';
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          // An unclosed quote: the rest of the text is the cell, rather than losing it.
          content += text.slice(j);
          j = n;
          break;
        }
        content += text.slice(j, q);
        if (text[q + 1] === '"') {
          content += '"';
          j = q + 2;
          continue;
        }
        j = q + 1;
        break;
      }
      // Anything between the closing quote and the delimiter is kept, not thrown away.
      let k = j;
      while (k < n && text[k] !== d && text[k] !== '\n') k++;
      value = content + text.slice(j, k).replace(/\s+$/, '');
      j = k;
    } else {
      let k = j;
      while (k < n && text[k] !== d && text[k] !== '\n') k++;
      value = text.slice(j, k).trim();
      j = k;
    }
    record.push(value);

    if (j >= n) break;
    if (text[j] === d) {
      i = j + 1;
      // A delimiter at the very end still opens one last, empty cell.
      if (i >= n) record.push('');
      continue;
    }
    // A line end.
    i = j + 1;
    if (endRecord()) return { records, more };
  }
  if (record.length && endRecord()) return { records, more };
  return { records, more };
}

/** The count most records share; a tie goes to the wider. */
function modeOf(counts: number[]): { mode: number; share: number } {
  const freq = new Map<number, number>();
  for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
  let mode = 0;
  let best = 0;
  for (const [c, f] of freq) {
    if (f > best || (f === best && c > mode)) {
      mode = c;
      best = f;
    }
  }
  return { mode, share: counts.length ? best / counts.length : 0 };
}

/** The delimiter that splits the first records into the same number of columns (two or more)
 * most often, counting only delimiters outside quotes. A comma when none does. */
function sniff(text: string): Delimiter {
  let best: Delimiter = ',';
  let bestShare = 0;
  for (const d of DELIMITERS) {
    const { records } = readRecords(text, d, SNIFF_RECORDS);
    const { mode, share } = modeOf(records.map((r) => r.length));
    if (mode < 2) continue;
    if (share > bestShare) {
      best = d;
      bestShare = share;
    }
  }
  return best;
}

/** Header names as columns can be told apart by: a blank is "column N", a repeat (in any case)
 * gets " (2)", " (3)"; a line break in a header reads as a space. */
function cleanHeaders(raw: string[], width: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < width; i++) {
    const base = (raw[i] ?? '').replace(/\s+/g, ' ').trim() || `column ${i + 1}`;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k++) name = `${base} (${k})`;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** One past the last non-empty cell. */
function usedWidth(cells: string[]): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== '') return i + 1;
  return 0;
}

/**
 * The text as a header and rows, every row as wide as the header. A row that stops early is
 * padded with ''; cells past the header are kept under "column N" headers (empty trailing cells
 * from an Excel export are not); at most MAX_ROWS rows and MAX_COLUMNS columns.
 */
export function parseDelimited(text: string): ParsedTable {
  const clean = normalize(text);
  const delimiter = sniff(clean);
  const { records, more } = readRecords(clean, delimiter, MAX_ROWS + 1);
  if (!records.length) return { headers: [], rows: [], delimiter, truncated: false };

  const [head, ...body] = records;
  let truncated = more;
  let width = usedWidth(head);
  for (const r of body) width = Math.max(width, usedWidth(r));
  if (width > MAX_COLUMNS) {
    width = MAX_COLUMNS;
    truncated = true;
  }
  const headers = cleanHeaders(head, width);
  const rows = body.map((r) => {
    const row = r.slice(0, width);
    while (row.length < width) row.push('');
    return row;
  });
  return { headers, rows, delimiter, truncated };
}

/** A cell no header would be: an address, a link or domain, or a number. */
function looksLikeData(cell: string): boolean {
  const c = cell.trim();
  if (!c) return false;
  if (c.includes('@')) return true;
  if (/^(?:https?:\/\/|www\.)/i.test(c)) return true;
  if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/i.test(c)) return true;
  return /^[-+$€£]?\d[\d,.\s]*%?$/.test(c);
}

/**
 * Whether the text is a table: a header line, then rows split the same way into two or more
 * columns. A list of company names, one a line, is not, and neither is "Acme, acme.com" a line:
 * a domain is never a column name, so that first line is a company, not a header.
 */
export function looksTabular(text: string): boolean {
  const clean = normalize(text);
  const d = sniff(clean);
  const { records } = readRecords(clean, d, SNIFF_RECORDS + 1);
  if (records.length < 2) return false;
  const [head, ...body] = records;
  if (head.length < 2 || head.some(looksLikeData)) return false;
  const same = body.filter((r) => r.length === head.length).length;
  return same / body.length >= 0.8;
}
