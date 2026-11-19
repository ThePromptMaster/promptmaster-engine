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

/**
 * `content` with every status word that disagrees with its row's status on the
 * review table rewritten, and the ids it changed.
 */
export function refreshStatusWords(content: string, rows: readonly StageItem[]): { content: string; changed: string[] } {
  const changed = new Set<string>();
  const lines = content.split('\n');
  for (const row of rows) {
    const want = wordFor(row);
    if (!row.id || !want) continue;
    const id = new RegExp(`\\b${escape(row.id)}\\b`);
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n];
      const at = line.search(id);
      if (at < 0) continue;
      // The row's status: the first status word after the id that is set out as one
      // (its own table cell, in bold, or after "remains/is/marked"), not a word of the
      // finding's own text ("still described Vendor A's standing as open").
      const words = new RegExp(`\\b${WORDS}\\b`, 'gi');
      words.lastIndex = at + row.id.length;
      for (let m = words.exec(line); m && m.index - at < 400; m = words.exec(line)) {
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
