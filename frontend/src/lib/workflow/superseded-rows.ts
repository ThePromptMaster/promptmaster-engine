/**
 * A decided review row whose finding rests on a value a later fact replaced
 * is kept, and said to be superseded (17 Oct, Sean: "The current review
 * retained old 20-day checks alongside a later superseding correction, making
 * current versus historical findings harder to interpret").
 *
 * The row is the user's decision, so it is never changed or dropped
 * (`restoreDecided`): it gains a `superseded_by` note naming the fact that
 * replaced its value, and the review folds it under "Earlier findings".
 * Pure.
 */

import { currentFacts, REPLACING, replacedClause } from './facts';
import { factValues, supersededValues, type SupersededValue } from './fact-values';
import type { StageItem } from './stage-artifact';
import type { ProjectFact } from '@/types/project';

/**
 * The values the current facts made untrue: those of a fact a newer one
 * superseded, and those a fact itself says it replaces ("replacing 20
 * business days") — the 20→12 change was recorded as one fact, with no
 * superseded row to compare.
 */
export function replacedValues(facts: readonly ProjectFact[] | undefined): SupersededValue[] {
  const byId = new Map((facts ?? []).map((f) => [f.id, f]));
  const current = currentFacts(facts);
  const out: SupersededValue[] = [];
  for (const f of current) {
    const old = f.supersedes ? byId.get(f.supersedes) : undefined;
    if (old) out.push(...supersededValues(old.statement, f.statement));
    const clause = replacedClause(f.statement);
    if (clause) out.push(...supersededValues(clause.was, clause.now).map((v) => ({ ...v, now: f.statement })));
  }
  // Still true where another current fact states it.
  const live = current.map((f) => factValues(f.statement));
  return out.filter((v) => !live.some((l, i) => l[v.kind].includes(v.value) && !REPLACING.test(current[i].statement)));
}

/** The decided rows of `rows` that state a replaced value as current, marked; every other row as it is. */
export function markSuperseded(rows: readonly StageItem[], replaced: readonly SupersededValue[]): StageItem[] {
  if (!replaced.length) return [...rows];
  return rows.map((row) => {
    if (!row.status || row.superseded_by) return row;
    const text = Object.entries(row)
      .filter(([k, v]) => !['id', 'status', 'status_source', 'superseded_by'].includes(k) && typeof v === 'string')
      .map(([, v]) => v)
      .join('. ');
    // A row that itself records the change ("rows citing 20 days are superseded") is current.
    if (REPLACING.test(text) || /\bsupersed/i.test(text)) return row;
    // A quotation counts: "each document states \"20 business days\"" is the old check.
    const found = factValues(text);
    const hit = replaced.find((v) => found[v.kind].includes(v.value) && !factValues(v.now)[v.kind].some((n) => n !== v.value && found[v.kind].includes(n)));
    return hit ? { ...row, superseded_by: hit.now } : row;
  });
}

export const isSuperseded = (row: StageItem) => Boolean(row.superseded_by?.trim());
