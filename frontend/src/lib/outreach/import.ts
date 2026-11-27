/**
 * Turning an imported list into contact rows (Sean, 26 Nov: "Keep the original data so I can see
 * what came from the list and what PromptMaster added"), and marking the rows nobody should be
 * written to blind: a person listed twice, a general inbox, someone already contacted, someone
 * whose colleague was, and an address or domain on the do-not-contact list.
 *
 * Pure: the table comes from `csv.ts`, the history and the do-not-contact list from the caller.
 * Every function returns new rows; nothing here edits a row it was given.
 */
import { blankContact, type ContactRow, type EarlierContact, type MappedField } from './contacts';

/** The header names each field is read from, lower case, Clay's export names among them. */
export const HEADER_SYNONYMS: Record<MappedField, string[]> = {
  first_name: ['first name', 'firstname', 'first'],
  last_name: ['last name', 'lastname', 'surname', 'last'],
  name: ['full name', 'name', 'contact name', 'person', 'contact'],
  role: ['job title', 'title', 'role', 'position', 'headline'],
  company: ['company', 'company name', 'organization', 'organisation', 'account', 'account name', 'employer'],
  website: ['website', 'company website', 'domain', 'company domain', 'url', 'company url', 'web'],
  email: ['email', 'work email', 'email address', 'e-mail', 'business email', 'work_email'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'person linkedin url', 'profile url'],
};

/** Field order matters only on a tie: a person's fields claim a header before the company's. */
const FIELDS: readonly MappedField[] = ['first_name', 'last_name', 'name', 'role', 'company', 'website', 'email', 'linkedin'];

/** "  Work_Email " and "work email" are the same header. */
export function normalizeHeader(header: string): string {
  return (header ?? '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

function words(text: string): string[] {
  return text.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Words that may sit beside a synonym without changing what the column holds: "Primary Email",
 * "Find Work Email", "Current Company", "Web Address", "Email (2)". Any other word makes it a
 * different column ("Email Status", "Company Size", "Last Contacted", "Company LinkedIn URL"),
 * which is matched only when it is exactly a synonym.
 */
const QUALIFIERS = new Set([
  'current', 'primary', 'main', 'work', 'business', 'corporate', 'professional', 'official', 'direct',
  'personal', 'person', 'contact', 'prospect', 'lead', 'job', 'full', 'clean', 'cleaned', 'final', 'best',
  'enriched', 'find', 'found', 'new', 'address', 'profile', 'page', 'site', 'link', 'url', 'of', 'the', 's',
]);

/** How many of `header`'s words are not `synonym`'s, when the synonym's words appear together in
 * it and every other word is a qualifier or a number; -1 when it does not hold the synonym. */
function extraWords(header: string[], synonym: string[]): number {
  if (!synonym.length || synonym.length > header.length) return -1;
  for (let i = 0; i + synonym.length <= header.length; i++) {
    if (!synonym.every((w, k) => header[i + k] === w)) continue;
    const rest = [...header.slice(0, i), ...header.slice(i + synonym.length)];
    if (rest.every((w) => QUALIFIERS.has(w) || /^\d+$/.test(w))) return rest.length;
  }
  return -1;
}

/**
 * Which column each field is read from. A header that is exactly a synonym wins; then one that
 * holds a synonym among qualifiers, the longer synonym first, then the fewer extra words, then the
 * earlier column. No column is read for two fields.
 */
export function guessMapping(headers: string[]): Partial<Record<MappedField, string>> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const out: Partial<Record<MappedField, string>> = {};

  for (const field of FIELDS) {
    for (const synonym of HEADER_SYNONYMS[field]) {
      const s = normalizeHeader(synonym);
      const i = norm.findIndex((h, idx) => !used.has(idx) && h === s);
      if (i >= 0) {
        out[field] = headers[i];
        used.add(i);
        break;
      }
    }
  }

  const candidates: { field: MappedField; index: number; length: number; extra: number }[] = [];
  norm.forEach((h, index) => {
    if (used.has(index)) return;
    const hw = words(h);
    for (const field of FIELDS) {
      if (out[field]) continue;
      for (const synonym of HEADER_SYNONYMS[field]) {
        const s = normalizeHeader(synonym);
        const extra = extraWords(hw, words(s));
        if (extra >= 0) candidates.push({ field, index, length: s.length, extra });
      }
    }
  });
  candidates.sort(
    (a, b) => b.length - a.length || a.extra - b.extra || a.index - b.index || FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field),
  );
  for (const c of candidates) {
    if (out[c.field] || used.has(c.index)) continue;
    out[c.field] = headers[c.index];
    used.add(c.index);
  }
  return out;
}

const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const TLD = '[a-z][a-z0-9-]*[a-z0-9]';
const ADDRESS = new RegExp(`^[^\\s@<>()\\[\\]\\\\,;:"]+@(?:${LABEL}\\.)+${TLD}$`);
const ADDRESS_IN_TEXT = new RegExp(`[^\\s@<>()\\[\\]\\\\,;:"']+@(?:${LABEL}\\.)+${TLD}`, 'i');
const HOST = new RegExp(`^(?:${LABEL}\\.)+${TLD}$`);

/**
 * The address in a cell as it was written, casing kept: "mailto:" and a "Name <…>" wrapper
 * taken off, the first address when a cell holds more than one. '' when there is none.
 */
export function addressIn(value: string): string {
  let v = (value ?? '').trim();
  if (!v) return '';
  const angled = /<([^<>]+)>/.exec(v);
  if (angled) v = angled[1].trim();
  if (/^mailto:/i.test(v)) v = v.replace(/^mailto:/i, '').replace(/\?.*$/, '').trim();
  if (ADDRESS.test(v.toLowerCase())) return v;
  const found = ADDRESS_IN_TEXT.exec(v);
  return found ? found[0] : '';
}

/**
 * An address as it is compared, never as it is shown: lower case, and for Gmail without dots or
 * a "+tag" and with googlemail.com read as gmail.com, since those all reach one inbox. '' when
 * the value holds no address.
 */
export function normalizeEmail(email: string): string {
  const a = addressIn(email).toLowerCase();
  if (!a) return '';
  const at = a.lastIndexOf('@');
  let local = a.slice(0, at);
  let domain = a.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    domain = 'gmail.com';
    if (!local) return '';
  }
  return `${local}@${domain}`;
}

/**
 * The domain in a website ("https://www.Acme.com/about" is "acme.com") or an address, lower
 * case and without "www."; '' when there is none ("Acme Inc").
 */
export function domainOf(value: string): string {
  let v = (value ?? '').trim().toLowerCase();
  if (v.startsWith('@')) v = v.slice(1);
  if (!v) return '';
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//;
  if (v.includes('@') && !scheme.test(v)) {
    const a = addressIn(v);
    return a ? a.slice(a.lastIndexOf('@') + 1).toLowerCase() : '';
  }
  let host = v.replace(scheme, '').replace(/^\/\//, '');
  host = host.split(/[\s/?#]/)[0];
  host = host.replace(/^[^@]*@/, '').replace(/:\d*$/, '').replace(/\.$/, '');
  host = host.replace(/^www\d*\./, '');
  return HOST.test(host) ? host : '';
}

/** A team's or a function's inbox, not a person's: a company with only one of these has no
 * contact yet, and the row says so rather than passing it off as a person. */
export const GENERAL_INBOX_LOCALS: readonly string[] = [
  'info', 'hello', 'contact', 'sales', 'support', 'team', 'office', 'admin', 'enquiries', 'inquiries',
  'help', 'marketing', 'press', 'media', 'hr', 'jobs', 'careers', 'billing', 'accounts', 'service',
  'mail', 'general', 'partnerships', 'bizdev', 'founders', 'hi',
];
const GENERAL_INBOXES = new Set([...GENERAL_INBOX_LOCALS, 'noreply', 'no-reply', 'donotreply', 'do-not-reply']);

/** '' when there is no address; 'general' for info@, sales+uk@, noreply@ and the like. */
export function inboxKind(email: string): '' | 'named' | 'general' {
  const a = addressIn(email).toLowerCase();
  if (!a) return '';
  const local = a.slice(0, a.lastIndexOf('@')).split('+')[0];
  return GENERAL_INBOXES.has(local) ? 'general' : 'named';
}

const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'pm.me', 'protonmail.com', 'ymail.com',
]);
const WEBMAIL_ANY_COUNTRY = /^(?:yahoo|hotmail|gmx|outlook|live)\.[a-z]{2,}(?:\.[a-z]{2,})?$/;

/** A personal mailbox's domain: it says nothing about where someone works. */
export function isWebmail(domain: string): boolean {
  const d = (domain ?? '').trim().toLowerCase().replace(/^@/, '').replace(/^www\./, '');
  return WEBMAIL.has(d) || WEBMAIL_ANY_COUNTRY.test(d);
}

/** The company's domain an address gives, or '' for a personal mailbox. */
function workDomainOf(email: string): string {
  const d = email ? domainOf(email) : '';
  return d && !isWebmail(d) ? d : '';
}

/** The row as it came in, keys in the file's column order. */
function givenJson(headers: string[], cells: string[]): string {
  return `{${headers.map((h, i) => `${JSON.stringify(h)}:${JSON.stringify(cells[i] ?? '')}`).join(',')}}`;
}

function oneLine(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** Fill a row's address fields from what the list gave. */
function withAddress(row: ContactRow, raw: string): void {
  const email = addressIn(raw);
  if (!email) return;
  row.email = email;
  row.email_kind = inboxKind(email);
  row.email_status = 'given';
  row.src_email = 'import';
}

/**
 * One contact per row of an imported table, `given` holding every column exactly as it came in.
 * A row with nothing in any mapped column is left out. A cell in the email column that holds no
 * address ("n/a") leaves `email` empty; `given` still shows it.
 */
export function rowsFromTable(input: {
  headers: string[];
  rows: string[][];
  mapping: Partial<Record<MappedField, string>>;
  importId: string;
  makeId: () => string;
}): ContactRow[] {
  const { headers, rows, mapping, importId, makeId } = input;
  const column = new Map<MappedField, number>();
  for (const field of FIELDS) {
    const header = mapping[field];
    const i = header === undefined ? -1 : headers.indexOf(header);
    if (i >= 0) column.set(field, i);
  }
  const out: ContactRow[] = [];
  for (const cells of rows) {
    const v = {} as Record<MappedField, string>;
    for (const field of FIELDS) {
      const i = column.get(field);
      v[field] = i === undefined ? '' : field === 'email' ? (cells[i] ?? '').trim() : oneLine(cells[i] ?? '');
    }
    if (FIELDS.every((f) => !v[f])) continue;

    const row = blankContact(makeId());
    row.given = givenJson(headers, cells);
    row.import_id = importId;
    row.company = v.company;
    row.name = v.name || [v.first_name, v.last_name].filter(Boolean).join(' ');
    row.role = v.role;
    if (row.role) row.src_role = 'import';
    row.website = v.website;
    withAddress(row, v.email);
    row.domain = domainOf(v.website) || workDomainOf(row.email);
    out.push(row);
  }
  return out;
}

const LIST_MARKER = /^(?:[-*•·◦‣]\s+|\d{1,4}[.)]\s+)/;
const WEB_TOKEN = new RegExp(`(?:https?:\\/\\/)?(?:${LABEL}\\.)+${TLD}(?::\\d+)?(?:\\/[^\\s,;|()]*)?`, 'gi');
const LIST_HEADER_WORDS = new Set([
  ...HEADER_SYNONYMS.company, ...HEADER_SYNONYMS.website, 'companies', 'websites', 'domains', 'urls', 'name', 'names',
].map(normalizeHeader));

/** Separators and an unpaired bracket off either end: "Acme (" is "Acme", "Acme (UK)" stays. */
function trimSeparators(text: string): string {
  let t = text;
  for (let pass = 0; pass < 3; pass++) {
    t = t.replace(/^[\s,;|:–—-]+/, '').replace(/[\s,;|:–—-]+$/, '');
    if (t.endsWith('(')) t = t.slice(0, -1);
    if (t.startsWith(')')) t = t.slice(1);
  }
  return t.trim();
}

/** The website in a line: one written with "http" or "www" first, else the last one. */
function websiteIn(line: string): { token: string; index: number } | null {
  const found: { token: string; index: number }[] = [];
  WEB_TOKEN.lastIndex = 0;
  for (let m = WEB_TOKEN.exec(line); m; m = WEB_TOKEN.exec(line)) {
    const before = m.index > 0 ? line[m.index - 1] : '';
    const after = line[m.index + m[0].length] ?? '';
    // Part of a word or an address ("info@acme.com"), not a website of its own.
    if (before && !/[\s,;|(\t:–—-]/.test(before)) continue;
    if (after && !/[\s,;|)\t]/.test(after)) continue;
    found.push({ token: m[0], index: m.index });
  }
  if (!found.length) return null;
  return found.find((f) => /^(?:https?:\/\/|www\.)/i.test(f.token)) ?? found[found.length - 1];
}

/**
 * One company a line, from a list like "Acme", "Acme, acme.com", "Acme - https://acme.com",
 * "acme.com" or "Acme<tab>https://acme.com". A bare domain gives a website and no company name:
 * the name is found later, not guessed from the domain. A first line that only names the
 * columns ("Company, Website") is not a company.
 */
export function rowsFromCompanyList(text: string, importId: string, makeId: () => string): ContactRow[] {
  const lines = (text ?? '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const out: ContactRow[] = [];
  let first = true;
  for (const original of lines) {
    let line = original.trim().replace(LIST_MARKER, '').trim();
    if (!line) continue;
    if (first) {
      first = false;
      const parts = line.split(/[,;\t|]/).map(normalizeHeader).filter(Boolean);
      if (parts.length && parts.every((p) => LIST_HEADER_WORDS.has(p))) continue;
    }

    const row = blankContact(makeId());
    row.given = JSON.stringify({ line: original });
    row.import_id = importId;

    const address = ADDRESS_IN_TEXT.exec(line);
    if (address) {
      withAddress(row, address[0]);
      line = `${line.slice(0, address.index)} ${line.slice(address.index + address[0].length)}`;
    }
    const site = websiteIn(line);
    if (site) {
      row.website = site.token;
      row.domain = domainOf(site.token);
      const before = trimSeparators(line.slice(0, site.index));
      const after = trimSeparators(line.slice(site.index + site.token.length));
      row.company = [before, after].filter(Boolean).join(', ');
    } else {
      row.company = address ? trimSeparators(line) : line;
    }
    if (!row.domain) row.domain = workDomainOf(row.email);
    out.push(row);
  }
  return out;
}

/** The keys a person is matched on: their address, and their name at their company's domain. */
export function emailKey(row: Pick<ContactRow, 'email'>): string {
  return normalizeEmail(row.email ?? '');
}

export function personKey(row: Pick<ContactRow, 'name' | 'domain'>): string {
  const name = (row.name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const domain = (row.domain ?? '').trim().toLowerCase();
  return name && domain ? `${name}|${domain}` : '';
}

/** Every key a row can be matched on, address first. */
export function contactKeys(row: Pick<ContactRow, 'email' | 'name' | 'domain'>): string[] {
  const keys: string[] = [];
  const e = emailKey(row);
  const p = personKey(row);
  if (e) keys.push(`email:${e}`);
  if (p) keys.push(`person:${p}`);
  return keys;
}

/** The one key a row is best known by ('' when it has neither an address nor a name at a domain). */
export function contactKey(row: Pick<ContactRow, 'email' | 'name' | 'domain'>): string {
  return contactKeys(row)[0] ?? '';
}

export const DUPLICATE_REASON = 'Same person as an earlier row.';

/**
 * The existing rows, then the incoming ones, each incoming row that repeats an earlier one
 * marked as its duplicate and skipped. Same person: the same address once normalized, or the same
 * name at the same domain (two addresses for one person are still one person to write to). A
 * duplicate points at the first row of that person, never at another duplicate. Existing rows are
 * returned as they were.
 */
export function markDuplicates(existing: ContactRow[], incoming: ContactRow[]): { rows: ContactRow[]; duplicates: number } {
  const firstWith = new Map<string, string>();
  const remember = (row: ContactRow, rootId: string) => {
    for (const key of contactKeys(row)) if (!firstWith.has(key)) firstWith.set(key, rootId);
  };
  for (const row of existing) remember(row, row.duplicate_of || row.id);

  let duplicates = 0;
  const added = incoming.map((row) => {
    const keys = contactKeys(row);
    const match = keys.map((k) => firstWith.get(k)).find((id): id is string => !!id);
    if (!match) {
      remember(row, row.id);
      return row;
    }
    duplicates++;
    remember(row, match);
    return { ...row, duplicate_of: match, status: 'skip' as const, reason: DUPLICATE_REASON };
  });
  return { rows: [...existing, ...added], duplicates };
}

/** The fields a re-import may say differently, compared by value. */
const COMPARED = ['name', 'role', 'email', 'company'] as const;
export const IMPORT_CHANGE_PREFIX = 'The new import says ';

/**
 * Bringing a list in again (Sean, 26 Nov: re-importing must not duplicate anyone or undo what was
 * decided). A row already on the list is not added again: when it says the same, it is counted
 * and left; when it says something different, the row on the list keeps everything it has (status,
 * research, its email and approval) and waits on the user with what the new import says
 * (`incoming`), answered under "Needs you". Repeats within the new list are marked as before.
 */
export function mergeImport(existing: ContactRow[], incoming: ContactRow[]): { rows: ContactRow[]; added: number; repeated: number; changed: number; duplicates: number } {
  const byKey = new Map<string, string>();
  for (const row of existing) for (const key of contactKeys(row)) if (!byKey.has(key)) byKey.set(key, row.duplicate_of || row.id);
  const rows = existing.map((r) => ({ ...r }));
  const fresh: ContactRow[] = [];
  let repeated = 0;
  let changed = 0;
  for (const row of incoming) {
    const match = contactKeys(row).map((k) => byKey.get(k)).find((id): id is string => !!id);
    const at = match ? rows.findIndex((r) => r.id === match) : -1;
    if (at < 0) {
      fresh.push(row);
      continue;
    }
    const mine = rows[at];
    const diff: Partial<Record<(typeof COMPARED)[number], string>> = {};
    for (const f of COMPARED) {
      const theirs = String(row[f] ?? '').trim();
      if (theirs && theirs.toLowerCase() !== String(mine[f] ?? '').trim().toLowerCase()) diff[f] = theirs;
    }
    if (!Object.keys(diff).length) {
      repeated += 1;
      continue;
    }
    changed += 1;
    const said = Object.entries(diff).map(([f, v]) => `${f} ${v}`).join(', ');
    rows[at] = {
      ...mine,
      incoming: JSON.stringify(diff),
      kept_status: mine.kept_status ?? mine.status ?? '',
      kept_reason: mine.kept_reason ?? mine.reason ?? '',
      status: 'decide',
      reason: `${IMPORT_CHANGE_PREFIX}${said}.`,
    };
  }
  const marked = markDuplicates(rows, fresh);
  return { rows: marked.rows, added: fresh.length, repeated, changed, duplicates: marked.duplicates };
}

export const SUPPRESSED_REASON = 'On your do-not-contact list.';

/** Later first; an undated contact counts as the oldest. */
function when(entry: EarlierContact): number {
  const t = entry.on ? Date.parse(entry.on) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

function latestBy(history: EarlierContact[], keyOf: (e: EarlierContact) => string): Map<string, EarlierContact> {
  const latest = new Map<string, EarlierContact>();
  for (const entry of history) {
    const key = keyOf(entry);
    if (!key) continue;
    const seen = latest.get(key);
    if (!seen || when(entry) > when(seen)) latest.set(key, entry);
  }
  return latest;
}

/** "2026-10-15T09:30:00Z" reads as the day it was. */
function dayOf(on: string | undefined): string {
  if (!on) return 'date unknown';
  return /^\d{4}-\d{2}-\d{2}T/.test(on) ? on.slice(0, 10) : on;
}

/**
 * The rows with earlier contact and the do-not-contact list marked on copies. Someone written to
 * before carries that contact (the latest) and, if nothing was decided about them yet, waits on
 * the user. Someone not written to, at a company where someone else was, carries that colleague's
 * contact and keeps their status. A row whose address or domain is on the do-not-contact list is
 * skipped whatever else is true of it; a duplicate keeps `duplicate_of`. Values already marked are
 * kept, never cleared, so a shorter history (a mailbox disconnected) does not unmark anyone.
 */
export function applyHistory(
  rows: ContactRow[],
  history: EarlierContact[],
  suppressed: { address?: string; domain?: string }[],
): ContactRow[] {
  const byAddress = latestBy(history, (e) => normalizeEmail(e.address));
  const byDomain = latestBy(history, (e) => workDomainOf(e.address));
  const blockedAddresses = new Set(suppressed.map((s) => normalizeEmail(s.address ?? '')).filter(Boolean));
  const blockedDomains = new Set(suppressed.map((s) => domainOf(s.domain ?? '')).filter(Boolean));

  return rows.map((original) => {
    const row: ContactRow = { ...original };
    const address = emailKey(row);
    const emailDomain = row.email ? domainOf(row.email) : '';
    const domain = (row.domain ?? '').toLowerCase();

    const earlier = address ? byAddress.get(address) : undefined;
    if (earlier) {
      row.contacted = JSON.stringify(earlier);
      if (!row.status || row.status === 'ready') {
        row.status = 'decide';
        row.reason = `Contacted before: ${dayOf(earlier.on)}.`;
      }
    } else {
      const workDomain = (domain && !isWebmail(domain) ? domain : '') || workDomainOf(row.email);
      const colleague = workDomain ? byDomain.get(workDomain) : undefined;
      if (colleague) row.colleague = JSON.stringify(colleague);
    }

    if (
      (address && blockedAddresses.has(address)) ||
      (domain && blockedDomains.has(domain)) ||
      (emailDomain && blockedDomains.has(emailDomain))
    ) {
      row.status = 'skip';
      row.reason = SUPPRESSED_REASON;
    }
    return row;
  });
}

/** "i1", "i2", …: one past the highest import id so far. */
export function nextImportId(existing: { id: string }[]): string {
  let n = 0;
  for (const { id } of existing) {
    const m = /^i(\d+)$/.exec(id ?? '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `i${n + 1}`;
}
