/**
 * How much of a draft is placeholders (18 Nov, Sean, Executive Search). He was
 * building a reusable template and had not supplied the role brief yet; Go
 * drafted a brief whose every field read "Not supplied", then checked it and
 * stopped on its sign-off. A draft that is mostly blanks has nothing to check
 * or repair until the material comes. Pure.
 */

/**
 * A value that only says nothing was given yet. Strong words only: "Not stated" is
 * a screening verdict's own word and "Pending" a task's status, so neither counts.
 */
const BLANK = /^(?:\*{0,2})(?:not\s+(?:yet\s+)?(?:supplied|provided|given)|none\s+(?:supplied|provided|given)|to\s+(?:be\s+)?(?:confirmed|supplied|provided)|tbc|tbd|tba|\[[^\]]*\])(?:\*{0,2})[.)]?(?:\s*\(.*\))?$/i;

/**
 * The units a draft fills, each blank or not: a "Label: value" line, or a table's
 * data row, which is blank when any of its cells after the first is a placeholder
 * (18 Nov manual pass: an intake record's nine rows each had "not supplied" beside
 * a filled "What belongs here" column, and counting cells read it as two-thirds full).
 */
function fieldUnits(text: string): boolean[] {
  const out: boolean[] = [];
  const lines = text.split('\n').map((l) => l.trim());
  lines.forEach((line, k) => {
    if (!line || /^#/.test(line) || /^\|?\s*:?-{3,}/.test(line)) return;
    if (line.startsWith('|')) {
      // A table's header is the row above its separator.
      if (/^\|?\s*:?-{3,}/.test(lines[k + 1] ?? '')) return;
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const values = cells.slice(1).filter(Boolean);
      if (values.length) out.push(values.some((v) => isBlank(v)));
      return;
    }
    const m = /^(?:[-*+]\s+)?(?:\*\*)?([^:]{2,60}?)(?:\*\*)?:\s*(.+)$/.exec(line);
    if (m) out.push(isBlank(m[2].trim()));
  });
  return out;
}

const isBlank = (v: string) => BLANK.test(v.replace(/\s+/g, ' ').trim());

/** The share of a draft's fields that are blanks, or null when it has too few fields to say. */
export function placeholderShare(text: string): { share: number; blanks: number; fields: number } | null {
  const units = fieldUnits(text);
  if (units.length < 4) return null;
  const blanks = units.filter(Boolean).length;
  return { share: blanks / units.length, blanks, fields: units.length };
}

/** The answer that keeps a blank draft as a template and lets Go carry on. */
export const KEEP_BLANK = 'Keep it as a blank template';
