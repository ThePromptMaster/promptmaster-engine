/**
 * Filling in the blanks from the web (Sean, 26 Nov: missing names, titles, addresses and personal
 * details found by PromptMaster, each with its source; a named person before a general inbox; why,
 * when nothing was found). The backend searches, reads and checks
 * (`backend/promptmaster/outreach_research.py`); this decides which rows go, and writes what came
 * back onto them. Pure: the runner (`research-run.ts`) and its tests use it.
 *
 * Research fills blanks only. A value the list had, or the user typed, is never replaced, and a
 * decision already on the row (contacted before, a colleague contacted) stays.
 */
import { REASONS, initialStatus, type ContactRow } from './contacts';
import { inboxKind } from './import';

/** One contact as the backend reads it. */
export interface ResearchRow {
  id: string;
  company: string;
  website: string;
  domain: string;
  name: string;
  role: string;
  email: string;
  detail: string;
}

export interface ResearchCandidate {
  name: string;
  role: string;
  email: string;
  why: string;
  source: string;
}

/** What the backend kept for one contact. Sources are "[S n]", renumbered as they are saved. */
export interface ResearchedRow {
  id: string;
  name: string;
  role: string;
  email: string;
  email_status: '' | 'verified' | 'guess' | 'none';
  detail: string;
  personal_line: string;
  src_name: string;
  src_role: string;
  src_email: string;
  src_detail: string;
  candidates: ResearchCandidate[];
  guessed_from: string;
  reason: string;
}

export const RESEARCH_BATCH = 5;

export const RESEARCH_REASONS = {
  guess: (from: string) => `Guessed from ${from}; no page shows this address. Use it, or find another.`,
  twoPeople: 'Two people could be right: choose one.',
  notFound: (why: string) => why || REASONS.noAddress,
} as const;

/** A general inbox PromptMaster found, which a named person's own address may replace; one the list or the user gave stays. */
function replaceableInbox(row: ContactRow): boolean {
  return row.email_kind === 'general' && row.src_email !== 'import' && row.src_email !== 'you' && row.email_status !== 'given';
}

/**
 * Rows worth a search: not skipped or a repeat, not searched before, and missing a person, an
 * address or a detail, or a named person with only a general inbox PromptMaster found (Sean: a
 * named person before a general inbox).
 */
export function needsResearch(row: ContactRow): boolean {
  if (row.status === 'skip' || row.duplicate_of || row.researched) return false;
  return !row.name.trim() || !row.email.trim() || !row.personal_line.trim() || (Boolean(row.name.trim()) && replaceableInbox(row));
}

export function researchRow(row: ContactRow): ResearchRow {
  // A replaceable general inbox is sent as no address, so the search looks for the person's own.
  const email = replaceableInbox(row) ? '' : row.email;
  return { id: row.id, company: row.company, website: row.website, domain: row.domain, name: row.name, role: row.role, email, detail: row.detail };
}

const cite = (s: string) => s.replace(/^\[|\]$/g, '').trim();

/** The decisions only the checks make; any other `decide` reason is the user's or the history's and stays. */
const OWN_REASONS = new Set<string>([REASONS.noAddress, REASONS.noName, REASONS.generalInbox, RESEARCH_REASONS.twoPeople]);
const isOwnReason = (reason: string | undefined) => !reason || OWN_REASONS.has(reason) || reason.startsWith('Guessed from ');

/** What research found, written onto the row: blanks only, each with its source, and where the row now stands. */
export function mergeResearch(row: ContactRow, found: ResearchedRow | undefined, at: string): ContactRow {
  const next: ContactRow = { ...row, researched: at };
  if (!found) return next;
  const added = new Set(row.added.split(',').map((s) => s.trim()).filter(Boolean));
  if (!row.name.trim() && found.name) {
    Object.assign(next, { name: found.name, src_name: cite(found.src_name) });
    added.add('name');
  }
  if (!row.role.trim() && found.role) {
    Object.assign(next, { role: found.role, src_role: cite(found.src_role) });
    added.add('role');
  }
  const inbox = replaceableInbox(row);
  if (found.email && (!row.email.trim() || (inbox && inboxKind(found.email) === 'named'))) {
    Object.assign(next, { email: found.email, email_status: found.email_status, email_kind: inboxKind(found.email), src_email: cite(found.src_email) });
    added.add('email');
  } else if (!row.email.trim() && found.email_status === 'none') {
    next.email_status = 'none';
  }
  if (!row.detail.trim() && found.detail) {
    Object.assign(next, { detail: found.detail, src_detail: cite(found.src_detail) });
    added.add('detail');
    if (!row.personal_line.trim() && found.personal_line) {
      next.personal_line = found.personal_line;
      added.add('personal_line');
    }
  }
  if (!row.candidates.trim() && found.candidates.length) next.candidates = JSON.stringify(found.candidates.slice(0, 2).map((c) => ({ ...c, source: cite(c.source) })));
  next.added = [...added].join(',');

  // Where it stands: a row someone decided keeps that; the checks' own reasons are worked out again.
  if (row.status === 'skip' || (row.status === 'decide' && !isOwnReason(row.reason))) return next;
  if (next.email_status === 'guess') return { ...next, status: 'decide', reason: RESEARCH_REASONS.guess(found.guessed_from) };
  if (!next.name.trim() && found.candidates.length >= 2) return { ...next, status: 'decide', reason: RESEARCH_REASONS.twoPeople };
  if (!next.email.trim()) return { ...next, status: 'decide', reason: RESEARCH_REASONS.notFound(found.reason) };
  // A general inbox kept after a search for the person's own: the user's call, as in the group.
  if (inbox && next.email_kind === 'general') return { ...next, status: 'decide', reason: REASONS.generalInbox };
  return initialStatus({ ...next, status: '', reason: '' });
}
