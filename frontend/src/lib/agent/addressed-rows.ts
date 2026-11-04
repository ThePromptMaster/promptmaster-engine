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
 * gives up to three quotes, one per problem the row names: the words of that
 * version that show it, or the measured result for a length or a count. Code
 * keeps a row only if every quote is in the saved text, or matches a
 * requirement measured as met on this stage. What the planner says about a row
 * is otherwise not trusted.
 *
 * One quote was not enough (same day, the next pass): i10 named three problems
 * (Session 1's timings, the Option A line, AI tool access), and the one quote
 * given was the AI tool line, shown beside "Session 1 timings sum to 105".
 */

import type { OpenRow } from './needs';
import { CARRIED_OUT_REASON } from '@/lib/workflow/triage';

/** One thing that shows a row carried out. */
export interface Evidence {
  quote: string;
  /** The quote is a requirement measured as met in code, not words of the text. */
  measured: boolean;
}

/** A row the current version carries out, with what shows it, in the row's order. */
export interface AddressedRow extends OpenRow {
  evidence: Evidence[];
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

/** One quote checked: in the text, or a requirement measured as met; null when neither. */
function shownBy(quote: string, body: string, measured: readonly Measured[]): Evidence | null {
  const q = quote.trim().replace(/^["“]+|["”]+$/g, '').trim();
  const nq = norm(q);
  if (nq.length < MIN_QUOTE || q.length > MAX_QUOTE) return null;
  if (body.includes(nq)) return { quote: q, measured: false };
  const byMeasure = measured.some((m) => {
    if (!m.satisfied) return false;
    const value = norm(m.value ?? '');
    return (value.length >= 3 && nq.includes(value)) || norm(`${m.label} ${m.value ?? ''}`).includes(nq);
  });
  return byMeasure ? { quote: q, measured: true } : null;
}

/**
 * The rows named in `raw` (the planner's `params.rows_addressed`: `{id,
 * quotes}` objects, or `{id, quote}`) that are undecided, named unambiguously,
 * and shown by every quote given (at most 3). Anything else is dropped, and the
 * row stays undecided.
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
    const { id, quote, quotes } = entry as Record<string, unknown>;
    const given = Array.isArray(quotes) ? quotes : typeof quote === 'string' ? [quote] : [];
    if (typeof id !== 'string' || !given.length || given.length > 3 || !given.every((q) => typeof q === 'string')) continue;
    // The same id on two review stages names neither.
    const matches = open.filter((r) => r.id === id.trim());
    if (matches.length !== 1) continue;
    const row = matches[0];
    if (out.some((a) => a.stageId === row.stageId && a.id === row.id)) continue;
    const evidence = (given as string[]).map((q) => shownBy(q, body, measured));
    // One quote the version does not bear out, and the row is not shown.
    if (evidence.some((e) => !e)) continue;
    out.push({ ...row, evidence: evidence as Evidence[] });
  }
  return out;
}

const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

/** What shows a row carried out, as one phrase: the words, then anything measured. */
function evidenceText(row: AddressedRow, max: number): string {
  const said = row.evidence.filter((e) => !e.measured).map((e) => `“${cut(e.quote, max)}”`);
  const measured = row.evidence.filter((e) => e.measured).map((e) => `“${cut(e.quote, max)}”`);
  return [
    ...(said.length ? [`it says ${said.join(', ')}`] : []),
    ...(measured.length ? [`measured in code ${measured.join(', ')}`] : []),
  ].join('; ');
}

/** The rows by id, stage and wording, each with what in this version shows it carried out. */
export function describeAddressed(rows: readonly AddressedRow[]): string {
  const shown = rows
    .slice(0, 4)
    .map((r) => `${r.id} (${r.stageLabel}) — “${cut(r.text, 120)}” — this version: ${evidenceText(r, 100)}`)
    .join('; ');
  return rows.length > 4 ? `${shown} (+${rows.length - 4})` : shown;
}

/** The reason recorded on the row when Go accepts it (`onlyRecordsCarriedOut` reads its start). */
export function carriedOutReason(row: AddressedRow, stageLabel: string, versionNumber?: number): string {
  return (
    `${CARRIED_OUT_REASON} ${stageLabel}${typeof versionNumber === 'number' ? ` v${versionNumber}` : ''}: ` +
    `${evidenceText(row, 200)}. Recorded by Go under your routine-decision policy; change it here if you disagree.`
  );
}
