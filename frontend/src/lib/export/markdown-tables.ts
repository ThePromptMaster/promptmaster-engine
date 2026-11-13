/**
 * The tables a Markdown document holds, read once for every export that needs
 * them: a slide's table (PowerPoint) and a workbook's sheets (Excel).
 *
 * A table is a header row, a rule row and the rows under it, as the app's own
 * writers produce them. Rows inside a fenced code block are code, not a table.
 */

export const TABLE_ROW = /^\s*\|.*\|\s*$/;
export const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\*\*\s*(.+?)\s*\*\*\s*:?\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** The words without the Markdown around them. A cell shows them as written, not with asterisks. */
export function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/** One table row as its cells. A pipe written `\|` belongs to the cell. */
export function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => plain(c.replace(/\\\|/g, '|')));
}

export interface MarkdownTable {
  /** The heading, or the bold line, the table sits under; empty when there is none. */
  title: string;
  /** The header row first, then the rows under it. Rule rows are not rows. */
  rows: string[][];
}

/** Every table in the document, in order, each with the heading it sits under. Pure. */
export function tablesIn(markdown: string): MarkdownTable[] {
  const out: MarkdownTable[] = [];
  const lines = markdown.split('\n');
  let title = '';
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING.exec(line) ?? BOLD_LINE.exec(line.trim());
    if (heading) {
      title = plain(heading[1]);
      continue;
    }
    if (!TABLE_ROW.test(line) || !TABLE_RULE.test(lines[i + 1] ?? '') || TABLE_RULE.test(line)) continue;
    const rows = [cells(line)];
    i += 2;
    while (i < lines.length && TABLE_ROW.test(lines[i])) {
      if (!TABLE_RULE.test(lines[i])) rows.push(cells(lines[i]));
      i += 1;
    }
    i -= 1;
    out.push({ title, rows });
  }
  return out;
}
