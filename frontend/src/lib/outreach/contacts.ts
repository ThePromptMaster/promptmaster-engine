/**
 * One contact on an Outreach list (Sean, 26 Nov: "Let me paste a list, upload a CSV from Clay,
 * or start with company names and websites. Keep the original data so I can see what came
 * from the list and what PromptMaster added").
 *
 * A row is a `StageItem`, so every value is a string: nested data (the imported row as it came
 * in, candidates, earlier contact) is kept as a JSON string, like the assess `profile`.
 */
import type { StageItem } from '@/lib/workflow/stage-artifact';

/**
 * Where a contact stands. '' (or absent) means not looked at yet.
 * - ready: has a person and an address to write to.
 * - decide: needs the user (two candidates, a guessed address, only a general inbox, contacted before).
 * - skip: left out, with a reason.
 */
export type ContactStatus = '' | 'ready' | 'decide' | 'skip';

/** Where a value came from: the import, a numbered web source ("S3"), the mailbox, or the user. */
export type ValueSource = 'import' | 'you' | 'mailbox' | `S${number}` | '';

export interface ContactRow extends StageItem {
  id: string;
  status?: ContactStatus;
  /** Why it is skipped or needs a decision, in plain words. */
  reason?: string;
  /** The imported row exactly as it came in: JSON of `Record<string, string>`, never edited. "" when added by hand. */
  given: string;
  /** Which import brought it in (an id from the stage document's `imports`). */
  import_id: string;
  company: string;
  website: string;
  /** The company's domain, lower case, from the website or a work address ("acme.com"). */
  domain: string;
  name: string;
  role: string;
  email: string;
  /** A named person's address, or a general inbox (info@, hello@ …). '' when no address. */
  email_kind: '' | 'named' | 'general';
  /** given: on the list; verified: a source shows it; guess: a pattern, not shown anywhere; none: not found. */
  email_status: '' | 'given' | 'verified' | 'guess' | 'none';
  /** The fields PromptMaster filled, comma separated ("name,role,email"). */
  added: string;
  src_name?: string;
  src_email: string;
  src_role: string;
  src_detail: string;
  /** One real detail about the company's work, and the line it becomes in the email. */
  detail: string;
  personal_line: string;
  /** JSON array of up to two `{ name, role, email?, why, source }`. */
  candidates: string;
  /** The id of the row this one repeats, when it is a duplicate. */
  duplicate_of: string;
  /** JSON `EarlierContact`: this person was reached before. */
  contacted: string;
  /** JSON `EarlierContact`: someone else at the same company was reached before. */
  colleague: string;
  /** When PromptMaster last searched the web for this row (ISO); '' when never. Not searched again by itself. */
  researched?: string;
  /** JSON of the values a later import says differently ("email", "role" …), waiting on the user. */
  incoming?: string;
  /** The status and reason the row had before a re-import asked, restored by "Keep what you had". */
  kept_status?: string;
  kept_reason?: string;
}

/** An earlier email or touch, from the project history, the person's Sent mail, or their own record. */
export interface EarlierContact {
  address: string;
  name?: string;
  /** ISO date, when known. */
  on?: string;
  source: 'promptmaster' | 'mailbox' | 'manual';
  subject?: string;
  thread_url?: string;
}

/** The fields a contact row starts with; every string field present. */
export function blankContact(id: string): ContactRow {
  return {
    id,
    status: '',
    reason: '',
    given: '',
    import_id: '',
    company: '',
    website: '',
    domain: '',
    name: '',
    role: '',
    email: '',
    email_kind: '',
    email_status: '',
    added: '',
    src_email: '',
    src_role: '',
    src_detail: '',
    detail: '',
    personal_line: '',
    candidates: '',
    duplicate_of: '',
    contacted: '',
    colleague: '',
  };
}

/** One import: when, from what, how many rows. Kept beside the rows in the stage document. */
export interface ImportRecord {
  id: string;
  at: string;
  /** "paste", "file: clay-export.csv", "companies". */
  from: string;
  rows: number;
  /** The column each contact field was read from. */
  mapping: Partial<Record<MappedField, string>>;
}

export type MappedField = 'first_name' | 'last_name' | 'name' | 'role' | 'company' | 'website' | 'email' | 'linkedin';

/** The Contacts stage's version: the rows, and the imports that brought them in. */
export interface ContactsDocument {
  kind: 'stage_items';
  items: ContactRow[];
  imports: ImportRecord[];
}

export function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function parseContacts(content: string | null | undefined): ContactsDocument {
  const doc = parseJson<Partial<ContactsDocument>>(content ?? undefined);
  return {
    kind: 'stage_items',
    items: Array.isArray(doc?.items) ? (doc!.items as ContactRow[]).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...blankContact(r.id), ...r })) : [],
    imports: Array.isArray(doc?.imports) ? doc!.imports : [],
  };
}

export function serializeContacts(doc: ContactsDocument): string {
  return JSON.stringify({ kind: 'stage_items', items: doc.items, imports: doc.imports } satisfies ContactsDocument, null, 2);
}

/** Why a contact waits, in words the row shows (English stored; the screen translates known ones). */
export const REASONS = {
  noAddress: 'No address yet.',
  generalInbox: 'Only a general inbox: write to it, or find a person first.',
  noName: 'An address but no name: check who it reaches.',
  duplicate: 'Same person as an earlier row.',
  suppressed: 'On your do-not-contact list.',
} as const;

/**
 * Where a row stands once imported and checked (Sean, 26 Nov: "If an address or detail is
 * uncertain, give me a row to resolve"). A row the checks already decided keeps that; otherwise a
 * named address with a name is ready, a general inbox or a missing name needs the user, and no
 * address waits to be found.
 */
export function initialStatus(row: ContactRow): ContactRow {
  if (row.status) return row;
  if (!row.email.trim()) return { ...row, status: '', reason: REASONS.noAddress };
  if (row.email_kind === 'general') return { ...row, status: 'decide', reason: REASONS.generalInbox };
  if (!row.name.trim()) return { ...row, status: 'decide', reason: REASONS.noName };
  return { ...row, status: 'ready', reason: '' };
}

/** How many rows stand where, for the summary above the table. */
export function contactCounts(rows: readonly ContactRow[]): { ready: number; decide: number; skip: number; open: number; total: number } {
  const c = { ready: 0, decide: 0, skip: 0, open: 0, total: rows.length };
  for (const r of rows) {
    if (r.status === 'ready') c.ready += 1;
    else if (r.status === 'decide') c.decide += 1;
    else if (r.status === 'skip') c.skip += 1;
    else c.open += 1;
  }
  return c;
}
