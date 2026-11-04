/**
 * Review rows the deliverable already carries out (4 Nov). Pure.
 *
 * 4 Nov, production (Lakeside proposal copy): Check raised i10 ("Session 1
 * timings sum to 105, not the stated 90") and i11 ("word count … about 720")
 * on the draft. Go then fixed both on Final proposal itself, checked it, and
 * asked for approval. The question still listed i10 and i11 as "Still
 * undecided before you approve", although Go's own reasoning said this
 * version had dealt with both. The rows were undecided, so they would also
 * have held "Objective met" up after the approval.
 *
 * When Go asks for approval on the deliverable, the planner may name the
 * undecided rows that the current version already carries out. For each one it
 * gives the words of that version that show it, or the measured result for a
 * length or a count. Code keeps a row only if that quote is in the saved text,
 * or matches a requirement measured as met on this stage. What the planner says
 * about a row is otherwise not trusted.
 */

import type { OpenRow } from './needs';
import { CARRIED_OUT_REASON } from '@/lib/workflow/triage';

/** A row the current version carries out, with what shows it. */
export interface AddressedRow extends OpenRow {
  quote: string;
  /** The quote is a requirement measured as met in code, not words of the text. */
  measured: boolean;
}

export interface Measured {
  label: string;
  satisfied: boolean;
  value?: string;
}

export const MIN_QUOTE = 8;
export const MAX_QUOTE = 300;

/** Case, quote marks, dashes, Markdown emphasis and table bars, and spacing set aside. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”«»„"]/g, '"')
    .replace(/[‘’`]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/[*_|#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The rows named in `raw` (the planner's `params.rows_addressed`: `{id,
 * quote}` objects) that are undecided, named unambiguously, and shown by their
 * quote. Anything else is dropped, and the row stays undecided.
 */
export function addressedRows(
  open: readonly OpenRow[],
  raw: unknown,
  text: string,
  measured: readonly Measured[] = []
): AddressedRow[] {
  if (!Array.isArray(raw) || !open.length) return [];
  const body = norm(text);
  const out: AddressedRow[] = [];
  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, quote } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof quote !== 'string') continue;
    // The same id on two review stages names neither.
    const matches = open.filter((r) => r.id === id.trim());
    if (matches.length !== 1) continue;
    const row = matches[0];
    if (out.some((a) => a.stageId === row.stageId && a.id === row.id)) continue;
    const q = quote.trim().replace(/^["“]+|["”]+$/g, '').trim();
    const nq = norm(q);
    if (nq.length < MIN_QUOTE || q.length > MAX_QUOTE) continue;
    const inText = body.includes(nq);
    const byMeasure =
      !inText &&
      measured.some((m) => {
        if (!m.satisfied) return false;
        const value = norm(m.value ?? '');
        return (value.length >= 3 && nq.includes(value)) || norm(`${m.label} ${m.value ?? ''}`).includes(nq);
      });
    if (!inText && !byMeasure) continue;
    out.push({ ...row, quote: q, measured: byMeasure });
  }
  return out;
}

const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/** The rows by id, stage and wording, each with what in this version shows it carried out. */
export function describeAddressed(rows: readonly AddressedRow[]): string {
  const shown = rows
    .slice(0, 4)
    .map((r) => `${r.id} (${r.stageLabel}) — “${cut(r.text, 120)}”; ${r.measured ? 'measured in code' : 'this version says'}: “${cut(r.quote, 120)}”`)
    .join('; ');
  return rows.length > 4 ? `${shown} (+${rows.length - 4})` : shown;
}

/** The reason recorded on the row when Go accepts it (`onlyRecordsCarriedOut` reads its start). */
export function carriedOutReason(row: AddressedRow, stageLabel: string, versionNumber?: number): string {
  return (
    `${CARRIED_OUT_REASON} ${stageLabel}${typeof versionNumber === 'number' ? ` v${versionNumber}` : ''}: ` +
    `${row.measured ? 'measured in code' : 'it says'} “${cut(row.quote, 200)}”. ` +
    'Recorded by Go under your routine-decision policy; change it here if you disagree.'
  );
}
