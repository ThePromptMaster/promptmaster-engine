/**
 * The project's material as one request carries it (15 Nov, Sean: "It extracted
 * about 417,000 characters from the file, but the setup screen says it only uses
 * the first 200,000. That leaves more than half the text out.").
 *
 * A project now keeps all of what was attached (`INPUT_LIMITS.context`). A
 * request still carries at most `CONTEXT_REQUEST_CHARS` of it, because the
 * material rides on every model call: a long text goes as its opening plus the
 * passages that match what this call is about, in the text's own order, with a
 * marker where something was left out and a first line saying how much was read.
 * A text that fits is sent whole and unchanged.
 *
 * Pure.
 */

import { cutText } from './clean-text';

/** What one request may carry of the project's material (`MAX_CONTEXT_CHARS` on the backend). */
export const CONTEXT_REQUEST_CHARS = 200_000;
/** The opening is always sent: what a document says first frames the rest. */
const OPENING_CHARS = 30_000;
/** Passages are cut at paragraph breaks, near this size. */
const PASSAGE_CHARS = 1_500;
/** Room for the first line and the markers. */
const MARKER_ROOM = 6_000;

const STOP = new Set(
  'the and for that with this from have will what which when where their there them they then than into about would should could been were your more most such only also each other these those over under after before while being does done make made just very some many much like within without between because through during against among upon onto here what whom whose shall must might ought'
    .split(' ')
);

/** The words a passage is matched on: four letters or more, or any number; lower-cased. */
export function termsOf(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{3,}|\p{N}[\p{N}.,%$]*/gu) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)));
}

interface Passage {
  start: number;
  text: string;
  /** The "### From <name>" heading it falls under, if any. */
  from: string | null;
}

/** The text after the opening, cut into passages at blank lines, each knowing its document. */
function passagesOf(text: string, from: number): Passage[] {
  const out: Passage[] = [];
  const headings = [...text.matchAll(/^### From (.+)$/gm)].map((m) => ({ at: m.index ?? 0, name: m[1].trim() }));
  const docAt = (pos: number) => headings.filter((h) => h.at <= pos).at(-1)?.name ?? null;
  let start = from;
  while (start < text.length) {
    let end = Math.min(text.length, start + PASSAGE_CHARS);
    if (end < text.length) {
      const brk = text.lastIndexOf('\n\n', end);
      if (brk > start + PASSAGE_CHARS / 3) end = brk + 2;
      else {
        const line = text.lastIndexOf('\n', end);
        if (line > start + PASSAGE_CHARS / 3) end = line + 1;
      }
    }
    const piece = cutText(text.slice(start), end - start);
    out.push({ start, text: piece, from: docAt(start) });
    start += piece.length || 1;
  }
  return out;
}

export interface RequestContext {
  context: string;
  /** Characters of the material sent, of all there is. */
  read: number;
  total: number;
  /** Passages sent after the opening. */
  passages: number;
}

/**
 * At most `limit` characters of `text`: the whole of it when it fits, otherwise
 * the opening and the passages that best match `focus`.
 */
export function contextForRequest(text: string, focus: string, limit = CONTEXT_REQUEST_CHARS): RequestContext {
  const total = text.length;
  if (total <= limit) return { context: text, read: total, total, passages: 0 };
  const opening = cutText(text, Math.min(OPENING_CHARS, Math.floor(limit / 4)));
  const budget = limit - opening.length - MARKER_ROOM;
  const wanted = termsOf(focus);
  const passages = passagesOf(text, opening.length);
  const scored = passages.map((p, i) => {
    const terms = termsOf(p.text);
    let hits = 0;
    for (const w of wanted) if (terms.has(w)) hits += 1;
    // Headings and short lists are cheap to keep and often what a step is about.
    return { i, score: hits + (/^#{1,3} /m.test(p.text) ? 0.5 : 0) };
  });
  // Best matches first; ties keep the text's order, so with no match at all the
  // passages after the opening are what is sent.
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = new Set<number>();
  let used = 0;
  for (const s of scored) {
    const size = passages[s.i].text.length + 80;
    if (used + size > budget) continue;
    chosen.add(s.i);
    used += size;
  }
  const order = [...chosen].sort((a, b) => a - b);
  const parts: string[] = [];
  let read = opening.length;
  let cursor = opening.length;
  let lastFrom: string | null = [...opening.matchAll(/^### From (.+)$/gm)].at(-1)?.[1]?.trim() ?? null;
  for (const i of order) {
    const p = passages[i];
    if (p.start > cursor) parts.push(`[… ${(p.start - cursor).toLocaleString('en-US')} characters not included in this request …]`);
    // A passage from a document whose heading was left out says where it is from.
    const label = p.from && p.from !== lastFrom && !p.text.startsWith('### From ') ? `(from ${p.from})\n` : '';
    parts.push(`${label}${p.text.trim()}`);
    lastFrom = p.from;
    read += p.text.length;
    cursor = p.start + p.text.length;
  }
  if (cursor < total) parts.push(`[… ${(total - cursor).toLocaleString('en-US')} characters not included in this request …]`);
  const header =
    `[The project's material is ${total.toLocaleString('en-US')} characters, all kept. This request carries ${read.toLocaleString('en-US')} of them: ` +
    `the opening and ${order.length} passage${order.length === 1 ? '' : 's'} that match what is being done now. Say so if something needed may be in a part not included.]`;
  const context = cutText([header, opening.trim(), ...parts].join('\n\n'), limit);
  return { context, read, total, passages: order.length };
}

/**
 * A field's value before and after a change, each within `limit` (15 Nov): with
 * the whole manuscript kept, an edit to a long context was a request the backend
 * refused for length. What did not change is trimmed from both ends alike, so
 * the change itself, with some text either side, is what is compared.
 */
export function changeWindow(before: string, after: string, limit = CONTEXT_REQUEST_CHARS): { before: string; after: string } {
  if (before.length <= limit && after.length <= limit) return { before, after };
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  const keep = 2_000;
  let from = Math.max(0, head - keep);
  // Never start on the second half of a pair.
  if (from > 0 && /[\uDC00-\uDFFF]/.test(before[from] ?? '')) from -= 1;
  const trim = (s: string) => {
    const to = Math.min(s.length, s.length - tail + keep);
    const body = s.slice(from, to);
    const marked = `${from > 0 ? '[…]\n' : ''}${body}${to < s.length ? '\n[…]' : ''}`;
    return cutText(marked, limit);
  };
  return { before: trim(before), after: trim(after) };
}
