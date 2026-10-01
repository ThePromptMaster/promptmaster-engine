/**
 * Putting a lookup's results onto the rows. Pure.
 *
 * A work the index has a record for becomes "Retrieved", with the record's
 * DOI or link and its real title on the row so the user can see what was
 * actually found. That is all it means: a record with this title exists.
 * Whether the work says what the row claims is still the user's to verify,
 * and a row the user has already verified is never downgraded.
 */

import type { StageItem, StageItemSchema } from './stage-artifact';

export interface WorkMatch {
  id: string;
  found: boolean;
  title: string;
  authors: string;
  year: number | null;
  doi: string;
  url: string;
  note: string;
}

export interface LookupResult {
  items: StageItem[];
  found: number;
  notFound: number;
  /** Rows that could not be looked up at all (the search was unreachable). */
  unreachable: number;
}

export function recordLine(match: WorkMatch): string {
  const who = match.authors ? ` — ${match.authors}` : '';
  return `${match.title}${who}${match.year ? ` (${match.year})` : ''}`;
}

export function applyLookup(items: readonly StageItem[], matches: readonly WorkMatch[], schema: StageItemSchema): LookupResult {
  const lookup = schema.lookup;
  if (!lookup) return { items: [...items], found: 0, notFound: 0, unreachable: 0 };
  const byId = new Map(matches.map((m) => [m.id, m]));
  let found = 0;
  let notFound = 0;
  let unreachable = 0;
  const next = items.map((item) => {
    const match = byId.get(item.id);
    if (!match) return item;
    if (!match.found) {
      if (/could not be reached/.test(match.note)) unreachable += 1;
      else notFound += 1;
      return item;
    }
    found += 1;
    const row: StageItem = { ...item, [lookup.recordField]: recordLine(match) };
    if (!(item[lookup.linkField] ?? '').trim()) row[lookup.linkField] = match.doi || match.url;
    // The user's own verification outranks a lookup.
    if (item.status_source !== 'user' || !item.status) {
      row.status = lookup.status;
      row.status_source = 'tool';
    }
    return row;
  });
  return { items: next, found, notFound, unreachable };
}

export function lookupSummary(result: LookupResult, itemLabel: string): string {
  const total = result.found + result.notFound + result.unreachable;
  const plural = (n: number) => `${n} ${itemLabel}${n === 1 ? '' : 's'}`;
  const parts = [`${result.found} of ${plural(total)} found in OpenAlex.`];
  if (result.notFound) parts.push(`${result.notFound} not found — ${result.notFound === 1 ? 'it' : 'they'} may be misremembered, or not exist.`);
  if (result.unreachable) parts.push(`${result.unreachable} could not be looked up; try again.`);
  if (result.found) parts.push('A found record means the work exists, not that it says what the row claims. Review, then save.');
  return parts.join(' ');
}
