/**
 * A manuscript's chapters, found in its own text (15 Nov: a tester wanted a
 * long-form project made out of his book, and Sean's 417,000-character
 * manuscript was cut to its first 200,000). A book project takes these as its
 * chapters, word for word; nothing is rewritten to find them and no model is
 * asked.
 *
 * Where the text marks its chapters — a heading kept from Word, an EPUB or an
 * ODT ("# Chapter One"), or a line such as "Chapter 4", "PART II" or "Prologue"
 * — those are the chapters. A text with no such marks is cut into parts of
 * about 20,000 characters at paragraph breaks.
 *
 * Pure.
 */

import { cutText } from './clean-text';

export interface Chapter {
  title: string;
  text: string;
}

/** Long enough to be a book rather than a brief: the start screen offers to use it as the manuscript. */
export const MANUSCRIPT_MIN_CHARS = 60_000;
/** A drafting stage holds at most this many chapters (`MAX_OUTLINE_SECTIONS`). */
export const MAX_CHAPTERS = 100;
const PART_CHARS = 20_000;
/** Text before the first chapter shorter than this (a title page) joins the first chapter. */
const FRONT_MATTER_MIN = 400;

const NUMBER_WORD = '(?:[0-9]+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
/**
 * "Chapter 4", "Part II: The Return", "BOOK ONE", "Chapter 2 The Long Night" — a
 * number is required, and words after it without a colon or dash must read as a
 * title (a capital first, no full stop at the end), so "Part of me…" and "Book
 * one of the trilogy sat there." stay prose.
 */
const NUMBERED_HEAD = new RegExp(`^(?:chapter|part|book)\\s+${NUMBER_WORD}\\b`, 'i');
function isNumberedHeading(line: string): boolean {
  const head = NUMBERED_HEAD.exec(line);
  if (!head) return false;
  const rest = line.slice(head[0].length).trim();
  if (!rest) return true;
  if (/^[:.–—-]/.test(rest)) return rest.length <= 82;
  return /^[\p{Lu}"“'‘]/u.test(rest) && !/[.!?]$/.test(rest) && rest.length <= 80;
}
/** "Prologue", "Epilogue: After", "Acknowledgements" — the word alone, or with a title after a colon or dash. */
const NAMED = /^(?:prologue|epilogue|introduction|preface|foreword|afterword|interlude|appendix|conclusion|acknowledg(?:e)?ments)(?:\s*[:.–—-]\s*[^\n]{0,80})?$/i;

interface Mark {
  at: number;
  end: number;
  title: string;
}

/** Heading lines ("# …" or "## …") the readers keep from Word, EPUB and ODT. */
function headingMarks(text: string): Mark[] {
  const marks: Mark[] = [];
  for (const m of text.matchAll(/^(#{1,2}) +(.+)$/gm)) {
    marks.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, title: m[2].trim() });
  }
  return marks;
}

/** Lines that name a chapter, standing alone between blank lines or at a page break. */
function namedMarks(text: string): Mark[] {
  const marks: Mark[] = [];
  let at = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length <= 100 && (isNumberedHeading(trimmed) || NAMED.test(trimmed))) {
      marks.push({ at, end: at + line.length, title: trimmed.replace(/^#+\s*/, '') });
    }
    at += line.length + 1;
  }
  return marks;
}

function partsOf(text: string): Chapter[] {
  const out: Chapter[] = [];
  let start = 0;
  const size = Math.max(PART_CHARS, Math.ceil(text.length / MAX_CHAPTERS));
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const brk = text.lastIndexOf('\n\n', end);
      if (brk > start + size / 2) end = brk;
    }
    const piece = cutText(text.slice(start), end - start);
    if (piece.trim()) out.push({ title: `Part ${out.length + 1}`, text: piece.trim() });
    start += piece.length || 1;
  }
  return out;
}

function fromMarks(text: string, marks: Mark[]): Chapter[] {
  const out: Chapter[] = [];
  const front = text.slice(0, marks[0].at).trim();
  marks.forEach((m, i) => {
    const body = text.slice(m.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim();
    out.push({ title: m.title, text: body });
  });
  if (front.length >= FRONT_MATTER_MIN) out.unshift({ title: 'Opening', text: front });
  else if (front && out.length) out[0] = { ...out[0], text: `${front}\n\n${out[0].text}`.trim() };
  // A heading with nothing under it (a table of contents line) joins the next.
  const merged: Chapter[] = [];
  for (const c of out) {
    const last = merged.at(-1);
    if (last && !last.text.trim()) merged[merged.length - 1] = { title: last.title, text: c.text ? `${c.title}\n\n${c.text}` : '' };
    else merged.push(c);
  }
  return merged.filter((c) => c.text.trim());
}

/**
 * The chapters of a manuscript. Never fewer than one; at most MAX_CHAPTERS. Every
 * character of the text is in exactly one chapter, apart from the heading lines
 * themselves, which become the titles.
 */
export function splitChapters(text: string): Chapter[] {
  const body = text.trim();
  if (!body) return [];
  for (const marks of [headingMarks(body), namedMarks(body)]) {
    if (marks.length >= 2 && marks.length <= MAX_CHAPTERS) {
      const chapters = fromMarks(body, marks);
      if (chapters.length >= 2) return chapters;
    }
  }
  return partsOf(body);
}

/** Whether a document reads as a book: long, and in more than one chapter. */
export function looksLikeManuscript(text: string): boolean {
  return text.length >= MANUSCRIPT_MIN_CHARS && splitChapters(text).length >= 2;
}
