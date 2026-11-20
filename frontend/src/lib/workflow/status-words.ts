/**
 * A deliverable's word for a finding's status follows the review table (19 Nov). Pure.
 *
 * Sean, Inventory Selection: "The final document marked review finding i8
 * 'undecided' while Go said it was accepted." The package's status column was a
 * model-written copy of the review: a fix wrote "**Undecided.**" into it, and one
 * second later Go recorded i8 as accepted on the review, so the approval was asked
 * on a version that contradicted the table. Code now writes the word from the table.
 *
 * Only a line that names the row's id and, close after it, a status word is
 * touched; the word is replaced, keeping its case and any bold around it.
 */

import { isSuperseded } from './superseded-rows';
import type { StageItem } from './stage-artifact';

const WORDS = '(?:undecided|accepted|applied|rejected|declined|open|pending|superseded)';

/** What the table says, as the word a document uses; null when the row's status says nothing to compare. */
function wordFor(row: StageItem): string | null {
  if (isSuperseded(row)) return 'superseded';
  if (row.status === 'accepted') return 'accepted';
  if (row.status === 'rejected') return 'rejected';
  if (!row.status) return 'undecided';
  return null;
}

/** The words that agree with a status: "Applied" is how a document says an accepted finding was carried out. */
const AGREES: Record<string, readonly string[]> = {
  accepted: ['accepted', 'applied'],
  rejected: ['rejected', 'declined'],
  undecided: ['undecided', 'open', 'pending'],
  superseded: ['superseded'],
};

function cased(word: string, like: string): string {
  if (like === like.toUpperCase()) return word.toUpperCase();
  if (like[0] === like[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SEPARATOR = /^\|?\s*:?-{2,}/;
const HEADING = /^(?:#{1,6}\s+.*|\*\*[^*]+\*\*:?)$/;
const cellsOf = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.replace(/[*_`]/g, '').trim());

/**
 * The rows of a findings table that number the review's findings without their
 * "i" (20 Nov, an inventory-selection pass: the package's "Review findings and
 * status" table numbered them 1 to 16, so "| 8 | … | Accepted |" was out of reach
 * of a check that looked for "i8"). A table is one when its header or the heading
 * above it names findings, and its numbers are exactly the review's: a table that
 * renumbered or left a finding out is not read, so "3" is never taken for i4.
 * Line index → the review id the row stands for.
 */
function numberedFindingRows(lines: readonly string[], rows: readonly StageItem[]): Map<number, string> {
  const out = new Map<number, string>();
  const ids = new Map<string, string>();
  for (const r of rows) {
    const n = /^i(\d+)$/i.exec(r.id ?? '')?.[1];
    if (n) ids.set(String(Number(n)), r.id!);
  }
  if (!ids.size) return out;
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (HEADING.test(t)) heading = t;
    if (!t.startsWith('|') || !SEPARATOR.test(lines[i + 1]?.trim() ?? '')) continue;
    const named = /\bfindings?\b/i.test(t) || /\bfindings?\b/i.test(heading);
    const table = new Map<number, string>();
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const n = /^(?:#\s*|i\s*)?(\d+)\.?$/i.exec(cellsOf(lines[j])[0] ?? '')?.[1];
      if (n) table.set(j, String(Number(n)));
    }
    const numbers = [...table.values()];
    const same = numbers.length === ids.size && new Set(numbers).size === numbers.length && numbers.every((n) => ids.has(n));
    if (named && same) for (const [line, n] of table) out.set(line, ids.get(n)!);
    i = j - 1;
  }
  return out;
}

/**
 * `content` with every status word that disagrees with its row's status on the
 * review table rewritten, and the ids it changed.
 */
export function refreshStatusWords(content: string, rows: readonly StageItem[]): { content: string; changed: string[] } {
  const changed = new Set<string>();
  const lines = content.split('\n');
  const numbered = numberedFindingRows(lines, rows);
  for (const row of rows) {
    const want = wordFor(row);
    if (!row.id || !want) continue;
    const id = new RegExp(`\\b${escape(row.id)}\\b`);
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      let at = line.search(id);
      let idLength = row.id.length;
      if (at < 0 && numbered.get(n) === row.id) {
        // The row's number, as its first cell: read from the cell after it.
        at = line.indexOf('|', line.indexOf('|') + 1);
        idLength = 0;
      }
      if (at < 0) continue;
      // The row's status: the first status word after the id that is set out as one
      // (its own table cell, in bold, or after "remains/is/marked"), not a word of the
      // finding's own text ("still described Vendor A's standing as open"). In a table
      // row the finding's own cell may be long, so the whole row is read.
      const reach = line.trim().startsWith('|') ? Infinity : 400;
      const words = new RegExp(`\\b${WORDS}\\b`, 'gi');
      words.lastIndex = at + idLength;
      for (let m = words.exec(line); m && m.index - at < reach; m = words.exec(line)) {
        const before = line.slice(0, m.index);
        const isStatus = /\*\*\s*$/.test(before) || /\|\s*$/.test(before) || /\b(?:remains|is|was|marked|status:?|now)\s+$/i.test(before);
        if (!isStatus) continue;
        if (!AGREES[want].includes(m[0].toLowerCase())) {
          lines[n] = `${before}${cased(want, m[0])}${line.slice(m.index + m[0].length)}`;
          changed.add(row.id);
        }
        break;
      }
    }
  }
  return { content: lines.join('\n'), changed: [...changed] };
}
