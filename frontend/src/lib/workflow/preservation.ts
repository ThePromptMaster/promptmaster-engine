/**
 * What a revision removed that it was not asked to remove (14 Oct).
 *
 * Sean, workshop: "change the start from 9 to 10 a.m., keeping all activity
 * durations and everything else unchanged". Every time moved correctly — and
 * the recheck that followed dropped "Confirm 12 attendees" from the checklist
 * and the invitation's greeting and sign-off. "We need it to check both that
 * the change was applied and that unaffected content survived."
 *
 * Compared in code, line by line, against the version the revision was made
 * from. A line counts as kept when the new text has it word for word, or with
 * only its numbers and times changed ("9:00 a.m." → "10:00 a.m."), or — for a
 * longer line — when nearly all its words are still there, reworded or split.
 * A short line that went (a greeting, a sign-off, a checklist item, a table
 * row) is put back where it stood; a longer passage that went is reported, not
 * put back, because a paragraph rewritten past recognition would otherwise
 * appear twice. Nothing is checked when the instruction asks for a rewrite or
 * a removal: then what goes is what was asked for.
 */

/** Instructions that ask for text to go, or for the whole to be rewritten. */
const REMOVES_OR_REWRITES =
  /\b(remov\w*|delet\w*|drop\w*|cut\w*|omit\w*|take out|get rid of|shorten\w*|shorter|trim\w*|condens\w*|concise|tighten\w*|rewrit\w*|rephras\w*|restructur\w*|simplif\w*|summari[sz]\w*|replace the (?:draft|text|whole)|start (?:again|over)|from scratch|less polished|more (?:casual|conversational|natural|formal)|tone|voice|reword\w*)\b/i;

/** Whether an instruction lets the revision remove what it likes. */
export function asksForRemovals(instruction: string): boolean {
  return REMOVES_OR_REWRITES.test(instruction);
}

/** The most words a line may have and still be put back by itself. */
const SHORT_LINE_WORDS = 14;

const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)|\bnoon\b|\bmidnight\b/gi;
const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;

function norm(line: string): string {
  return line
    .replace(/[*_`#>]/g, ' ')
    .replace(/^\s*(?:[-+]|\d+[.)])\s+/, '')
    .replace(/[“”"’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The line with its numbers and times as placeholders: a moved time is the same line. */
const masked = (line: string) => norm(line).replace(TIME, '#').replace(NUMBER, '#').replace(/[^\p{L}\p{N}#\s]/gu, '').replace(/\s+/g, ' ').trim();
const words = (line: string) => masked(line).split(' ').filter((w) => w && w !== '#');

export interface Removal {
  /** The line as it stood in the earlier version. */
  line: string;
  /** Put back where it stood (short lines); otherwise only reported. */
  restorable: boolean;
}

/** The lines of `before` that `after` no longer has, kept or moved or not. */
export function removedLines(before: string, after: string): Removal[] {
  if (isJson(before) || isJson(after)) return [];
  const afterLines = after.split('\n').map((l) => l.trim()).filter(Boolean);
  const afterExact = new Set(afterLines.map(norm));
  const afterMasked = new Set(afterLines.map(masked));
  const afterWords = new Set(afterLines.flatMap(words));
  const out: Removal[] = [];
  for (const raw of before.split('\n')) {
    const line = raw.trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line) || /^#{1,6}\s/.test(line) || /^what changed\b/i.test(norm(line))) continue;
    if (afterExact.has(norm(line)) || afterMasked.has(masked(line))) continue;
    const w = words(line);
    if (!w.length) continue;
    // A longer line reworded or split across lines still has its words.
    if (w.length > 3 && w.filter((x) => afterWords.has(x)).length / w.length >= 0.75) continue;
    out.push({ line: raw.replace(/\s+$/, ''), restorable: w.length <= SHORT_LINE_WORDS });
  }
  return out;
}

const isJson = (text: string) => /^\s*[{[]/.test(text) && /[}\]]\s*$/.test(text);

/**
 * `after` with the short lines it dropped put back where they stood in
 * `before`: after the nearest earlier line that survived, with the blank
 * lines around them as they were.
 */
export function restoreLines(before: string, after: string, lines: readonly string[]): string {
  if (!lines.length) return after;
  const want = new Set(lines.map((l) => l.trim()));
  const b = before.split('\n');
  const a = after.split('\n');
  const afterNorm = a.map((l) => norm(l));
  const afterMask = a.map((l) => masked(l));
  /** Where a surviving line of `before` stands in `after`, or -1. */
  const placeOf = (line: string) => {
    if (!line.trim()) return -1;
    const exact = afterNorm.indexOf(norm(line));
    if (exact >= 0) return exact;
    const m = afterMask.indexOf(masked(line));
    if (m >= 0) return m;
    // A reworded paragraph: the line of `after` sharing most of its words.
    const w = words(line);
    if (w.length <= 3) return -1;
    let best = -1;
    let score = 0.5;
    a.forEach((l, i) => {
      const lw = new Set(words(l));
      const s = w.filter((x) => lw.has(x)).length / w.length;
      if (s > score) [best, score] = [i, s];
    });
    return best;
  };
  /** Runs of lines to put back, each after a line of `after` (or at the top: -1). */
  const inserts = new Map<number, string[]>();
  let anchor = -1;
  let i = 0;
  while (i < b.length) {
    if (!(b[i].trim() && want.has(b[i].trim()))) {
      const at = placeOf(b[i]);
      if (at >= 0) anchor = at;
      i += 1;
      continue;
    }
    // A run: the lines to put back, with any blank lines between them.
    const run: string[] = i > 0 && !b[i - 1].trim() ? [''] : [];
    while (i < b.length && (!b[i].trim() || want.has(b[i].trim()))) {
      run.push(b[i]);
      i += 1;
    }
    inserts.set(anchor, [...(inserts.get(anchor) ?? []), ...run]);
  }
  const out: string[] = [];
  const top = inserts.get(-1);
  if (top) out.push(...top);
  a.forEach((l, i) => {
    out.push(l);
    const add = inserts.get(i);
    if (add) out.push(...add);
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, after.endsWith('\n') ? '\n' : '');
}

export interface Preserved {
  /** The revision with the short lines it dropped put back. */
  text: string;
  /** The lines put back. */
  restored: string[];
  /** Longer passages that went and were not put back, for the record. */
  reported: string[];
}

/**
 * A revision checked against the version it was made from: what it removed
 * without being asked is put back, or reported. `keep` can refuse a line —
 * one stating a value a fact has since replaced must not come back.
 */
export function keepUnasked(
  before: string,
  after: string,
  instruction: string,
  keep: (line: string) => boolean = () => true
): Preserved {
  if (!before.trim() || !after.trim() || asksForRemovals(instruction)) return { text: after, restored: [], reported: [] };
  const removed = removedLines(before, after).filter((r) => keep(r.line));
  const restored = removed.filter((r) => r.restorable).map((r) => r.line.trim());
  const reported = removed.filter((r) => !r.restorable).map((r) => r.line.trim());
  return { text: restoreLines(before, after, restored), restored, reported };
}

/** "“Hello,”, “Best,” and “Confirm 12 attendees.”" — lines named for a person to read. */
export function describeLines(lines: readonly string[], max = 4): string {
  const shown = lines.slice(0, max).map((l) => `“${norm(l).length > 70 ? `${l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim().slice(0, 67)}…` : l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()}”`);
  const more = lines.length > max ? ` and ${lines.length - max} more` : '';
  if (shown.length <= 1) return shown.join('') + more;
  return `${shown.slice(0, -1).join(', ')}${more ? ', ' : ' and '}${shown.at(-1)}${more}`;
}
