/**
 * Putting a lookup's results onto the rows. Pure.
 *
 * A work the index has a record for becomes "Retrieved", with the record's
 * DOI or link and its real title on the row so the user can see what was
 * actually found. That is all it means: a record with this title exists.
 * Whether the work says what the row claims is still the user's to verify,
 * and a row the user has already verified is never downgraded.
 */

import { itemSchemaFor, newItemId, type StageItem, type StageItemSchema } from './stage-artifact';
import type { StageDefinition } from './types';

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

const words = (text: string) => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');

/**
 * The records a topic search returned, as new rows. Pure apart from row ids.
 *
 * Each row names the work as the index holds it, carries its DOI, and is
 * "Retrieved" by the tool. What the work established and how it bears on the
 * question are left empty: nobody has read it, and a sentence there would be
 * the model's guess sitting next to a real DOI. A record already on the list
 * (by DOI, or by title) is not added twice, and the list is never grown past
 * what the stage holds.
 */
export function rowsFromSearch(matches: readonly WorkMatch[], existing: readonly StageItem[], schema: StageItemSchema): StageItem[] {
  const lookup = schema.lookup;
  if (!lookup?.search) return [];
  const have = existing.map((i) => ({
    link: (i[lookup.linkField] ?? '').trim().toLowerCase(),
    text: words(`${i[lookup.field] ?? ''} ${i[lookup.recordField] ?? ''}`),
  }));
  const max = schema.fields.find((f) => f.key === lookup.field)?.max ?? 240;
  const room = Math.max(0, schema.maxItems - existing.length);
  const rows: StageItem[] = [];
  for (const match of matches) {
    if (rows.length >= room) break;
    if (!match.found || !match.title.trim()) continue;
    const link = (match.doi || match.url).trim();
    const title = words(match.title);
    if (have.some((h) => (link && h.link === link.toLowerCase()) || (title && h.text.includes(title)))) continue;
    have.push({ link: link.toLowerCase(), text: title });
    const row: StageItem = { id: newItemId() };
    for (const field of schema.fields) row[field.key] = '';
    const lead = [match.authors, match.year ? `(${match.year})` : ''].filter(Boolean).join(' ');
    row[lookup.field] = `${lead ? `${lead}. ` : ''}${match.title}`.slice(0, max);
    row[lookup.linkField] = link;
    row[lookup.recordField] = recordLine(match);
    row.status = lookup.status;
    row.status_source = 'tool';
    rows.push(row);
  }
  return rows;
}

/**
 * Whether the stage already holds as many found works as it asks for.
 *
 * Read from the stage's own `min_items_with_status` requirement on the status
 * a lookup sets. Once that is met, another topic search only adds rows nobody
 * chose: on production (4 Oct) Go searched a second time after revising,
 * added five off-topic works, then spent its next step revising them out.
 */
export function enoughWorksFound(stage: StageDefinition, items: readonly StageItem[], schema: StageItemSchema): boolean {
  const status = schema.lookup?.status;
  if (!status) return false;
  const rule = stage.exit_criteria
    .map((c) => c.rule)
    .find((r): r is Extract<NonNullable<typeof r>, { type: 'min_items_with_status' }> =>
      r?.type === 'min_items_with_status' && r.statuses.includes(status));
  if (!rule) return false;
  return items.filter((i) => rule.statuses.includes(i.status ?? '')).length >= rule.n;
}

/** PromptMaster's reading of one source's abstract (POST /api/agent/verify-sources). */
export interface SourceVerdict {
  id: string;
  verdict: 'supports' | 'partly' | 'does_not' | 'cannot_tell';
  quote: string;
  basis: 'abstract' | 'none';
  note: string;
}

export interface VerifyResult {
  items: StageItem[];
  supported: number;
  contradicted: number;
  /** Read but not settled, or not readable at all: the user's. */
  open: number;
}

/** The rows a found record can be read for: found by the lookup, with a link, and not decided by the user. */
export function verifyQueries(items: readonly StageItem[], schema: StageItemSchema, max = 20): { id: string; claim: string; link: string }[] {
  const lookup = schema.lookup;
  const verify = lookup?.verify;
  if (!lookup || !verify) return [];
  return items
    .filter((i) => i.status === lookup.status && (i[lookup.linkField] ?? '').trim())
    .map((i) => ({ id: i.id, claim: (i[verify.claimField] || i[lookup.field] || '').trim(), link: (i[lookup.linkField] ?? '').trim() }))
    .filter((q) => q.claim)
    .slice(0, max);
}

/**
 * Put what the abstract showed onto the rows (5 Oct). Pure.
 *
 * Supported → "AI verified"; contradicted → "AI checked — does not support",
 * which still waits for the user; anything else keeps "Retrieved" / "Source
 * found". Each reading is recorded on the row — what was read, when, and the
 * sentence relied on — and a row the user decided is never touched.
 */
export function applyVerification(
  items: readonly StageItem[],
  verdicts: readonly SourceVerdict[],
  schema: StageItemSchema,
  today = new Date().toISOString().slice(0, 10)
): VerifyResult {
  const lookup = schema.lookup;
  const verify = lookup?.verify;
  if (!lookup || !verify) return { items: [...items], supported: 0, contradicted: 0, open: 0 };
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const max = schema.fields.find((f) => f.key === lookup.recordField)?.max ?? 500;
  let supported = 0;
  let contradicted = 0;
  let open = 0;
  const next = items.map((item) => {
    const v = byId.get(item.id);
    if (!v || item.status !== lookup.status || item.status_source === 'user') return item;
    const what =
      v.verdict === 'supports' ? 'supports this' : v.verdict === 'does_not' ? 'does not support this' : v.verdict === 'partly' ? 'supports only part of this' : null;
    const note = what
      ? `AI check of the abstract (${today}): ${what} — “${v.quote.slice(0, 180)}”`
      : `AI check (${today}): ${v.note || 'not settled by the abstract'}`;
    const record = [(item[lookup.recordField] ?? '').replace(/ · AI check[^]*$/, '').trim(), note].filter(Boolean).join(' · ').slice(0, max);
    const row: StageItem = { ...item, [lookup.recordField]: record };
    if (v.verdict === 'supports') {
      row.status = verify.supports;
      row.status_source = 'tool';
      supported += 1;
    } else if (v.verdict === 'does_not') {
      row.status = verify.contradicts;
      row.status_source = 'tool';
      contradicted += 1;
    } else open += 1;
    return row;
  });
  return { items: next, supported, contradicted, open };
}

export function verifySummary(result: VerifyResult): string {
  const parts: string[] = [];
  if (result.supported) parts.push(`${result.supported} AI verified from the abstract.`);
  if (result.contradicted) parts.push(`${result.contradicted} where the abstract says something else — yours to correct or check.`);
  if (result.open) parts.push(`${result.open} the abstract does not settle, or could not be read — yours to check in full.`);
  return parts.join(' ');
}

/**
 * Whether a stage's rows name sources PromptMaster could still look up or
 * read: a stage that verifies (5 Oct), with a row nobody decided that names a
 * source and has not been read yet.
 */
export function sourcesToCheck(stage: StageDefinition, items: readonly StageItem[]): boolean {
  const schema = itemSchemaFor(stage);
  const lookup = schema.lookup;
  if (!lookup?.verify) return false;
  const open = items.filter((i) => i.status_source !== 'user' && i.status !== lookup.verify!.supports && i.status !== lookup.verify!.contradicts);
  return lookupQueries(open, schema).length > 0;
}
