/**
 * A new version that only rewords the old one (25 Oct, Sean, quantum
 * gravity: "five completed stages fell back to three Awaiting recheck").
 * Every save on a stage reopened the done work after it, so each repair Go
 * made reopened the stages after the one it repaired. A save that changes
 * nothing a later stage could have used — no figure, no item ID, no
 * citation, no heading, no negation or hedge, no status — and changes few
 * words reopens nothing (as confirming proposals already did, L-66). Pure.
 *
 * Deliberately conservative: anything it cannot show is a rewording counts
 * as a change, and the later stages are reopened as before.
 */

/** At most this share of words may differ (counted as a bag, both ways)… */
const MAX_WORD_CHANGE = 0.1;
/** …and never more than this many: a new paragraph in a long chapter is not wording. */
const MAX_WORDS_CHANGED = 120;

/** Fields whose value is a decision, never wording. */
const DECISION_KEYS = new Set(['id', 'status', 'status_source', 'kind', 'verdict', 'severity', 'decision', 'stage_id', 'version']);

const FIGURE = /\d[\d,.]*\s*%?/g;
const ITEM_ID = /\b[A-Z]{1,3}-?\d+[a-z]?\b/g;
const CITATION = /\[[A-Z]?\d+(?:[,–-]\s*[A-Z]?\d+)*\]/g;
const URL = /https?:\/\/\S+/g;
const HEADING = /^#{1,6}\s+.*$/gm;
/** Words that turn a claim round or change how firmly it is made. */
const TURNING =
  /\b(?:not|no|never|none|nor|cannot|can't|won't|isn't|aren't|wasn't|weren't|doesn't|didn't|without|fail(?:s|ed)?|unsupported|unverified|refuted|rejected|insufficient|unlikely|likely|may|might|could|would|should|must|conditional|speculative|calculated|verified|reproduced|estimated|approximately|only|all|every|some)\b/gi;

function tally(text: string, pattern: RegExp): string {
  return (text.match(pattern) ?? []).map((t) => t.toLowerCase().replace(/\s+/g, '')).sort().join('|');
}

function words(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) bag.set(w, (bag.get(w) ?? 0) + 1);
  return bag;
}

/** Two texts that say the same thing in slightly different words. */
export function proseRewords(before: string, after: string): boolean {
  if (before === after) return true;
  if (!before.trim() || !after.trim()) return false;
  for (const p of [FIGURE, ITEM_ID, CITATION, URL, HEADING, TURNING]) {
    if (tally(before, p) !== tally(after, p)) return false;
  }
  const a = words(before);
  const b = words(after);
  let total = 0;
  let changed = 0;
  for (const [w, n] of a) {
    total += n;
    changed += Math.abs(n - (b.get(w) ?? 0));
  }
  for (const [w, n] of b) {
    total += n;
    if (!a.has(w)) changed += n;
  }
  return total > 0 && changed / total <= MAX_WORD_CHANGE && changed <= MAX_WORDS_CHANGED;
}

function parse(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

function sameShapeRewords(a: unknown, b: unknown, key: string | null): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return true;
    return !(key && DECISION_KEYS.has(key)) && proseRewords(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameShapeRewords(x, b[i], key));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join('\u0000') !== kb.join('\u0000')) return false;
    return ka.every((k) => sameShapeRewords((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k));
  }
  return a === b;
}

/**
 * The new version changes only wording: nothing a later stage could have
 * read off the old one is different. Structured content (rows, sections)
 * must keep every row, ID and status; only its text may be reworded.
 */
export function onlyRewords(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!before?.trim() || !after?.trim() || before === after) return false;
  const a = parse(before);
  const b = parse(after);
  if (a.ok !== b.ok) return false;
  if (a.ok && b.ok) return sameShapeRewords(a.value, b.value, null);
  return proseRewords(before, after);
}
