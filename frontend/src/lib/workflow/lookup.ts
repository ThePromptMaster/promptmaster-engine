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

/** A source cell that says there is none: "none", "none found", "n/a", "unknown", "—". */
const NAMES_NOTHING = /^(none|no source|n\/?a|unknown|not (found|known|available)|[-–—?]+)\b[\s\w]{0,12}$/i;

/** The rows worth searching for: something is named, and the row does not say nothing was found. At most `max`. */
export function lookupQueries(items: readonly StageItem[], schema: StageItemSchema, max = 20): { id: string; work: string }[] {
  const lookup = schema.lookup;
  if (!lookup) return [];
  return items
    .filter((i) => !lookup.skipStatus || i.status !== lookup.skipStatus)
    .map((i) => ({ id: i.id, work: (i[lookup.field] ?? '').trim() }))
    .filter((w) => w.work && !NAMES_NOTHING.test(w.work))
    .slice(0, max);
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
    // The user's own decision outranks a lookup — including one made before
    // sources were recorded, when only a user could have decided a row.
    const option = schema.statuses?.find((o) => o.value === item.status);
    const usersOwn = item.status_source === 'user' || (!item.status_source && option !== undefined && option.decided !== false);
    if (!usersOwn || !item.status) {
      row.status = lookup.status;
      row.status_source = 'tool';
    }
    return row;
  });
  return { items: next, found, notFound, unreachable };
}

/** `noun` is what was looked up, plural ("works", "sources"); `notFoundNote` replaces the default reading of a miss. */
export function lookupSummary(result: LookupResult, noun: string, notFoundNote?: string): string {
  const total = result.found + result.notFound + result.unreachable;
  const plural = (n: number) => `${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
  const parts = [`${result.found} of ${plural(total)} found in OpenAlex.`];
  if (result.notFound) parts.push(notFoundNote ? `${result.notFound} not found. ${notFoundNote}` : `${result.notFound} not found — ${result.notFound === 1 ? 'it' : 'they'} may be misremembered, or not exist.`);
  if (result.unreachable) parts.push(`${result.unreachable} could not be looked up; try again.`);
  if (result.found) parts.push('A found record means the work exists, not that it says what the row claims. Review, then save.');
  return parts.join(' ');
}
