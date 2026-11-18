/**
 * How much of a draft is placeholders (18 Nov, Sean, Executive Search). He was
 * building a reusable template and had not supplied the role brief yet; Go
 * drafted a brief whose every field read "Not supplied", then checked it and
 * stopped on its sign-off. A draft that is mostly blanks has nothing to check
 * or repair until the material comes. Pure.
 */

/** A value that only says nothing was given. */
const BLANK = /^(?:\*{0,2})(?:not\s+(?:yet\s+)?(?:supplied|provided|given|stated|specified|known)|none\s+(?:supplied|provided|given)|to\s+(?:be\s+)?(?:confirmed|supplied|provided)|tbc|tbd|tba|unknown|n\/?a|pending|\[[^\]]*\]|[-–—]|…|\.\.\.)(?:\*{0,2})[.)]?(?:\s*\(.*\))?$/i;

/** The fields a draft fills: "Label: value" lines and table cells after the first column. */
function fieldValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^#/.test(line) || /^\|?\s*:?-{3,}/.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      out.push(...cells.slice(1).filter(Boolean));
      continue;
    }
    const m = /^(?:[-*+]\s+)?(?:\*\*)?([^:]{2,60}?)(?:\*\*)?:\s*(.+)$/.exec(line);
    if (m) out.push(m[2].trim());
  }
  return out;
}

/** The share of a draft's fields that are blanks, or null when it has too few fields to say. */
export function placeholderShare(text: string): { share: number; blanks: number; fields: number } | null {
  const values = fieldValues(text);
  if (values.length < 4) return null;
  const blanks = values.filter((v) => BLANK.test(v.replace(/\s+/g, ' ').trim())).length;
  return { share: blanks / values.length, blanks, fields: values.length };
}

/** The answer that keeps a blank draft as a template and lets Go carry on. */
export const KEEP_BLANK = 'Keep it as a blank template';
