/**
 * The contacts waiting on the user, grouped so one press answers a group (Sean, 26 Nov: an
 * uncertain address or detail is a row to resolve, without resolving forty rows one at a time).
 * Pure code, no model: a group is the rows that share the same question and the same two answers.
 * Choosing between two people stays on its row.
 */
import { REASONS, initialStatus, type ContactRow } from './contacts';
import { RESEARCH_REASONS } from './research';

export type DecisionKind = 'guess' | 'general' | 'no_name' | 'contacted' | 'not_found';

export interface DecisionGroup {
  kind: DecisionKind;
  /** Stable within a list: the kind, and for guesses the domain. */
  key: string;
  /** For guesses: the company domain the pattern was read at. */
  domain?: string;
  rowIds: string[];
}

function kindOf(row: ContactRow): DecisionKind | null {
  if (row.status !== 'decide') return null;
  const reason = row.reason ?? '';
  if (row.email_status === 'guess' && reason.startsWith('Guessed from ')) return 'guess';
  if (reason === REASONS.generalInbox) return 'general';
  if (reason === REASONS.noName) return 'no_name';
  if (reason.startsWith('Contacted before')) return 'contacted';
  if (!row.email.trim() && reason !== RESEARCH_REASONS.twoPeople) return 'not_found';
  return null;
}

const ORDER: DecisionKind[] = ['contacted', 'guess', 'general', 'no_name', 'not_found'];

export function groupDecisions(rows: readonly ContactRow[]): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>();
  for (const row of rows) {
    const kind = kindOf(row);
    if (!kind) continue;
    const key = kind === 'guess' ? `guess:${row.domain}` : kind;
    const g = groups.get(key) ?? { kind, key, ...(kind === 'guess' ? { domain: row.domain } : {}), rowIds: [] };
    g.rowIds.push(row.id);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.key.localeCompare(b.key));
}

/** What each answer does, in the words saved on the row. */
const USE: Record<DecisionKind, string | null> = {
  guess: 'You chose to use the guessed address.',
  general: 'You chose to write to the general inbox.',
  no_name: 'You chose to write to this address without a name.',
  contacted: 'You chose to write again although they were contacted before.',
  // Nothing to write to: the only answer is to skip.
  not_found: null,
};
const SKIP: Record<DecisionKind, string> = {
  guess: 'Guessed address not used.',
  general: 'Only a general inbox.',
  no_name: 'No name for the address.',
  contacted: 'Contacted before.',
  not_found: 'No address found.',
};

export function canUse(kind: DecisionKind): boolean {
  return USE[kind] !== null;
}

/** One press on a group: every row in it is ready (keeping what the user chose) or skipped with the reason. */
export function decideGroup(rows: readonly ContactRow[], group: DecisionGroup, answer: 'use' | 'skip'): ContactRow[] {
  const ids = new Set(group.rowIds);
  return rows.map((row) => {
    if (!ids.has(row.id) || kindOf(row) !== group.kind) return row;
    if (answer === 'skip') return { ...row, status: 'skip', reason: SKIP[group.kind] };
    const note = USE[group.kind];
    return note ? { ...row, status: 'ready', reason: note } : row;
  });
}

/** Choosing one of two people on a row: their name, role and (when a page showed it) address, with the source. */
export function chooseCandidate(row: ContactRow, index: number): ContactRow {
  let list: { name: string; role: string; email: string; source: string }[] = [];
  try {
    list = JSON.parse(row.candidates || '[]');
  } catch {
    return row;
  }
  const c = list[index];
  if (!c) return row;
  const added = new Set(row.added.split(',').filter(Boolean));
  added.add('name');
  if (c.role) added.add('role');
  const next: ContactRow = { ...row, name: c.name, src_name: c.source, role: row.role || c.role, src_role: row.role ? row.src_role : c.source, status: '', reason: '' };
  if (c.email && !row.email.trim()) {
    Object.assign(next, { email: c.email, email_status: 'verified', src_email: c.source, email_kind: 'named' });
    added.add('email');
  }
  next.added = [...added].join(',');
  // A person with no address of their own goes back for one search for it (27 Nov pass: choosing a
  // person on a general inbox marked the row ready, and nothing looked for their address).
  if (!c.email) next.researched = '';
  return initialStatus(next);
}
