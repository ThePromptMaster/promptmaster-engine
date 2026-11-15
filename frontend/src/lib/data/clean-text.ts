/**
 * Text the database will store (15 Nov, Sean: a physics paper attached, and
 * "Could not create the project. Nothing was created — try again"; with the
 * paper taken out, the same start worked).
 *
 * Postgres refuses two things a document can bring with it: a NUL character
 * (pdf.js turns a math glyph it cannot map into its raw code, and code 0 is
 * NUL), and half of a surrogate pair. Mathematical letters such as 𝑥 are two
 * UTF-16 units each, and a cut at a fixed length — the 200,000-character
 * context, an 80-character preview cell, a 60-character title — could fall
 * between the two halves. JSON carries the lone half as `\ud835`, which
 * PostgREST cannot turn into text, so the whole insert failed.
 *
 * Pure.
 */

/** Control characters other than tab, newline and carriage return. */
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Every lone half of a surrogate pair replaced by U+FFFD; pairs are kept. */
export function wellFormed(text: string): string {
  const native = (text as string & { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === 'function') return native.call(text);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (isHigh(code) && i + 1 < text.length && isLow(text.charCodeAt(i + 1))) {
      out += text[i] + text[i + 1];
      i += 1;
    } else if (isHigh(code) || isLow(code)) {
      out += '�';
    } else {
      out += text[i];
    }
  }
  return out;
}

/** Text with nothing in it Postgres or a JSON body refuses. */
export function storableText(text: string): string {
  return wellFormed(text.replace(CONTROL_CHARS, ''));
}

/** The first `end` UTF-16 units, never ending on the first half of a pair. */
export function cutText(text: string, end: number): string {
  if (end >= text.length) return text;
  if (end <= 0) return '';
  return text.slice(0, isHigh(text.charCodeAt(end - 1)) ? end - 1 : end);
}

/** Every string inside a value made storable: for a JSON column such as a file's preview. */
export function storableValue<T>(value: T): T {
  if (typeof value === 'string') return storableText(value) as T;
  if (Array.isArray(value)) return value.map((v) => storableValue(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, storableValue(v)])) as T;
  }
  return value;
}

/**
 * What went wrong, from anything thrown. Supabase returns its errors as plain
 * objects, and the start screen threw one as it was: "instanceof Error" was
 * false, so the database's own reason was replaced by "Could not create the
 * project." and nobody could tell what had failed.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return typeof e === 'string' ? e : '';
}
