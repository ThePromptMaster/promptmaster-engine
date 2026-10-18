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

/** Things a document is made of, as a revision note names them. */
const DOC_PART = String.raw`(?:summary|tracker|log|table|pack|draft|document|report|section|closing sentence|opening sentence|heading|column|row|list|paragraph|chapter|introduction|conclusion)`;

const NOTE_PATTERNS: readonly RegExp[] = [
  // A labelled note.
  /^(?:what changed|change note|changes? (?:in|to|made in) this (?:version|revision|draft)|correction note|revision note|note on this (?:version|revision))\b/,
  // The model narrating its own revision. "I" only: "We kept the Friday
  // deadline" is the document speaking for its authors.
  /^i (?:followed|kept|set aside|added|removed|changed|updated|dropped|moved|corrected|restored|regrouped|folded|replaced|rewrote|reworded|fixed|left|renamed|restated)\b/,
  // 'KES-T2 now reads "60% as last reported"'.
  /\bnow (?:reads|says) ["“]/,
  // "The summary now includes …", "The tracker's last column is now "…"",
  // "The log is regrouped …", "The closing sentence is dropped …".
  new RegExp(
    String.raw`^(?:the|this|each|every)\s+(?:[\w-]+'s\s+)?(?:[\w-]+\s+){0,2}${DOC_PART}s?\b[^.]*?\b(?:now (?:includes?|lists?|shows?|states?|has|have|carries|carry|groups?|names?)|(?:is|are) now ["“]|(?:is|are|was|were|has been|have been) (?:now )?(?:added|removed|dropped|regrouped|folded|moved|renamed|replaced|updated|corrected|changed|reworded|restated|merged|split|reordered|shortened)\b)`
  ),
];

/**
 * A line about the revision rather than part of the document: "The summary now
 * includes the $6,000 … calculation", "I followed the accepted facts …" (18 Oct,
 * pilot: the kept-lines guard put such a line back into the pack after a review
 * had asked for it to go). A table row is never one — a change log's rows are
 * the document — and a sentence about the subject ("It is now forecast to
 * finish November 12") names no part of the document.
 */
export function isChangeNote(line: string): boolean {
  const text = line
    .trim()
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '')
    .replace(/[*_`>]/g, '')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!text || text.startsWith('|') || /^#{1,6}\s/.test(text)) return false;
  return NOTE_PATTERNS.some((re) => re.test(text));
}

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
  const afterSets = afterLines.map((l) => new Set(words(l)));
  const out: Removal[] = [];
  for (const raw of before.split('\n')) {
    const line = raw.trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line) || /^#{1,6}\s/.test(line) || isChangeNote(line)) continue;
    if (afterExact.has(norm(line)) || afterMasked.has(masked(line))) continue;
    const w = words(line);
    if (!w.length) continue;
    // A longer line reworded or split across lines still has its words.
    if (w.length > 3 && w.filter((x) => afterWords.has(x)).length / w.length >= 0.75) continue;
    // A short line that was edited in place: one new line has all its words
    // (14 Oct, prod: "- Training (0 minutes) — Maya" became "- 9:15 a.m.–10:15
    // a.m. — Training … Maya facilitates", and the old line was put back beside it).
    if (w.length >= 2 && afterSets.some((set) => w.every((x) => set.has(x)))) continue;
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

/** "minutes" and "0-minute" are the same word to a reader. */
const stem = (w: string) => w.toLowerCase().replace(/(?:ies)$/, 'y').replace(/(?<=[a-z]{3})s$/, '');
const stems = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2).map(stem));

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
  // A line the instruction itself names ("the 0-minute Training item") was
  // asked about: whatever became of it is the instruction's doing.
  const named = stems(instruction);
  const mentioned = (line: string) => {
    const w = [...new Set(words(line).map(stem))].filter((x) => x.length > 2);
    return w.filter((x) => named.has(x)).length >= Math.min(2, w.length);
  };
  const removed = removedLines(before, after).filter((r) => keep(r.line) && !mentioned(r.line));
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
