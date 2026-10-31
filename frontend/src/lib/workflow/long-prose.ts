/**
 * A prose stage too long to write back in one call, cut into parts. Pure.
 *
 * 31 Oct (Sean, a nonfiction book at v8): "Full revisions keep getting cut
 * off by the length limit". The book was one prose page, and a repair asked
 * the model to return all of it — 60,000 words against a ceiling of about
 * 9,000 (`STAGE_PROSE_MAX_TOKENS` in `backend/promptmaster/stage.py`). It was
 * cut off twice and Go stopped. A text over `PART_WORDS` is revised a part at
 * a time: split at its headings, each part revised on its own call, and the
 * parts joined back in code.
 *
 * Parts are cut at line starts, so `parts.join('')` is the text exactly.
 */

import { countWords } from './measurable';

/**
 * The most a part may hold. The ceiling on one prose call is 12,000 tokens,
 * about 9,000 words; a part is kept well under it so a revision that adds a
 * little still fits.
 */
export const PART_WORDS = 5_000;

const HEADING = /^(#{1,6})\s+\S/;

/** True when the text is too long to be revised in one call. */
export function needsParts(text: string, max = PART_WORDS): boolean {
  return countWords(text) > max;
}

/** Line-start offsets of the headings at `level`, outside code fences. */
function headingStarts(text: string, level: number): number[] {
  const out: number[] = [];
  let at = 0;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced ? HEADING.exec(line) : null;
    if (m && m[1].length === level) out.push(at);
    at += line.length + 1;
  }
  return out;
}

/** Cut at the given offsets; the first piece is what comes before them. */
function cutAt(text: string, starts: number[]): string[] {
  const bounds = [0, ...starts.filter((s) => s > 0), text.length];
  const out: string[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const piece = text.slice(bounds[i], bounds[i + 1]);
    if (piece) out.push(piece);
  }
  return out;
}

/** Paragraph boundaries (a blank line), for a section with no headings left to cut at. */
function paragraphStarts(text: string): number[] {
  const out: number[] = [];
  const re = /\n[ \t]*\n(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m.index + m[0].length);
  return out;
}

/** One piece cut smaller until each piece is within `max`, by deeper headings, then paragraphs. */
function pieces(text: string, max: number, level: number): string[] {
  if (countWords(text) <= max) return [text];
  for (let l = level; l <= 6; l += 1) {
    const starts = headingStarts(text, l).filter((s) => s > 0);
    if (starts.length) return cutAt(text, starts).flatMap((p) => pieces(p, max, l + 1));
  }
  const paras = paragraphStarts(text);
  return paras.length ? cutAt(text, paras) : [text];
}

/**
 * The text as parts of at most `max` words each where its structure allows,
 * cut at its highest heading level first (chapters), and neighbouring small
 * pieces put back together so a part is as large as it may be.
 */
export function splitIntoParts(text: string, max = PART_WORDS): string[] {
  if (!needsParts(text, max)) return [text];
  const small = pieces(text, max, 1);
  const out: string[] = [];
  let current = '';
  for (const p of small) {
    if (current && countWords(current) + countWords(p) > max) {
      out.push(current);
      current = p;
    } else {
      current += p;
    }
  }
  if (current) out.push(current);
  return out;
}

/** The headings of the whole text, as a part's call is shown them. */
export function headingOutline(text: string, maxLines = 80): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && HEADING.test(line)) lines.push(line.trim());
  }
  return lines.slice(0, maxLines).join('\n');
}

/** What each part's call is told about where it sits. */
export function partInstruction(index: number, count: number, outline: string): string {
  return (
    ` THIS TEXT IS LONG, SO IT IS REVISED ONE PART AT A TIME: this is part ${index + 1} of ${count}, given as the existing text.` +
    (outline ? ` The whole text's headings, in order:\n${outline}\n` : ' ') +
    'Return ONLY this part, revised, starting where it starts and keeping its headings. Do not write any other part, a title or introduction for the whole work, a closing summary, or a list of sources. ' +
    'Where nothing in this part is affected, return it exactly as it is.'
  );
}

/** Join revised parts: each ends with a newline so the next heading starts a line. */
export function joinParts(parts: readonly string[]): string {
  return parts
    .map((p, i) => (i < parts.length - 1 && !p.endsWith('\n') ? `${p.replace(/\s+$/, '')}\n\n` : p))
    .join('');
}
