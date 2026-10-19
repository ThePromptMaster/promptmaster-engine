/**
 * An approver must have a source (15 Oct, Sean, HARBOR: "One version named
 * Elena as the original $40,000 budget approver, although the baseline did not
 * identify that approver").
 *
 * Like the figure check (`figure-support.ts`), this is lexical and by code:
 * every person a stage's text names as approving something — "approved by
 * Elena", "Elena approved", "Elena's approval", "Approver: Elena" — must be
 * named as approving something in the project's own material (the brief, its
 * context, the accepted facts). Earlier stages do not count: a model wrote
 * them, and the misattribution travels stage to stage. One that is not
 * becomes a finding on the stage check.
 *
 * It checks the name, not the item: Elena approving the November change does
 * not let the check tell whether she approved the baseline too. The prompt
 * (HISTORY_RULE) asks for that; the register says so.
 *
 * Roles count as approvers too — the board, the CEO (18 Oct, Sean, Summit:
 * the decision log said the analysis approver was unknown while quoting the
 * board's authorization). A role named as approving needs the same source a
 * name does, and a line that calls an approver unknown is checked against the
 * material: if the material records who authorized that item, it is a finding.
 */

import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';
import { currentFacts } from './facts';

const NAME = String.raw`([A-Z][a-z]{2,})`;
/** Approving bodies and officers, as the material names them. */
const ROLE_WORDS = String.raw`board(?: of directors)?|(?:audit |finance |steering )?committee|CEO|CFO|COO|CTO|CIO|chair(?:man|woman|person)?|president|managing partner|chief [a-z]+ officer`;
const ROLE = String.raw`(?:the\s+)?(${ROLE_WORDS})`;
const PATTERNS = [
  new RegExp(String.raw`\b(?:approved|authori[sz]ed|signed off)\s+by\s+(?:sponsor\s+)?${NAME}`, 'g'),
  new RegExp(String.raw`\b${NAME}\s+(?:has\s+|had\s+)?(?:approved|authori[sz]ed|signed off)\b`, 'g'),
  new RegExp(String.raw`\b${NAME}['’]s\s+(?:approval|authori[sz]ation|sign-?off)\b`, 'g'),
  new RegExp(String.raw`\bapprover\s*[:\-–—]\s*${NAME}`, 'gi'),
];
const ROLE_PATTERNS = [
  new RegExp(String.raw`\b(?:approved|authori[sz]ed|signed off)\s+by\s+${ROLE}\b`, 'gi'),
  new RegExp(String.raw`\b${ROLE}\s+(?:has\s+|had\s+)?(?:approved|authori[sz]ed|authori[sz]es|approves|signed off)\b`, 'gi'),
  new RegExp(String.raw`\b${ROLE}['’]s\s+(?:approval|authori[sz]ation|sign-?off)\b`, 'gi'),
  new RegExp(String.raw`\bapprover\s*[:\-–—]\s*${ROLE}\b`, 'gi'),
];
/** A role as one spelling: "the Board of Directors" and "board" are the same approver. */
function roleKey(role: string): string {
  const r = role.toLowerCase().replace(/\s+/g, ' ').trim();
  return /^board/.test(r) ? 'board' : /^[a-z]{3}$/.test(r) ? r.toUpperCase() : r;
}
function roleIn(sentence: string, role: string): boolean {
  const re = role === 'board' ? /\bboard\b/i : new RegExp(String.raw`\b${role.replace(/\s+/g, '\\s+')}\b`, /^[A-Z]{3}$/.test(role) ? '' : 'i');
  return re.test(sentence);
}
/** Capitalised words that are not people. */
const NOT_NAMES = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'The', 'This', 'That', 'Not', 'Never', 'Was', 'Has', 'Have', 'Had', 'Been', 'Budget', 'Launch', 'Date', 'Sponsor',
  'Change', 'Changes', 'Plan', 'Project', 'Board', 'Committee', 'Chair', 'Chairman', 'President', 'Nobody', 'None', 'Who', 'Which', 'Already', 'Formally', 'Also', 'Since',
]);
/** A sentence that says someone has NOT approved names no approver. */
const NEGATED = /\b(?:not|never|hasn['’]t|hadn['’]t|no one|nobody|without|pending|awaiting|unapproved)\b/i;
const APPROVING = /\b(?:approv|authori[sz]|sign(?:ed)?[- ]?off)/i;

function sentences(text: string): string[] {
  return text.replace(/\\n/g, '\n').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/** The people `text` names as approving something. */
export function approversNamed(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    if (NEGATED.test(s)) continue;
    for (const re of PATTERNS) {
      for (const m of s.matchAll(re)) {
        const name = m[1];
        if (name && !NOT_NAMES.has(name) && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}

/** The roles `text` names as approving something: "board", "CEO". */
export function rolesNamed(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    if (NEGATED.test(s)) continue;
    for (const re of ROLE_PATTERNS) {
      for (const m of s.matchAll(re)) {
        const role = m[1] ? roleKey(m[1]) : '';
        if (role && !out.includes(role)) out.push(role);
      }
    }
  }
  return out;
}

/** The names and roles in `content` given as approvers whom none of `sources` names as approving anything. */
export function unsupportedApprovers(content: string, sources: readonly string[]): string[] {
  const approving = sources.flatMap(sentences).filter((s) => APPROVING.test(s));
  const names = approversNamed(content).filter((name) => !approving.some((s) => new RegExp(String.raw`\b${name}\b`).test(s)));
  const roles = rolesNamed(content).filter((role) => !approving.some((s) => roleIn(s, role)));
  return [...names, ...roles.map((r) => (r === 'board' ? 'the board' : `the ${r}`))];
}

/** "Approver unknown", "approver: not recorded", "approved by an unknown approver". */
const UNKNOWN_APPROVER = /\b(?:approver|approved by|authori[sz]ed by)\b[^.;\n]{0,40}?\b(?:unknown|not (?:recorded|known|stated|identified|named)|unrecorded|unspecified|tbd)\b|\bunknown approver\b/i;
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;
const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'in', 'on', 'with', 'by', 'is', 'was', 'be', 'has', 'have', 'had', 'this', 'that', 'approver', 'approved', 'approval', 'authorized', 'authorised', 'authorizes', 'authorises', 'authorization', 'unknown', 'not', 'recorded', 'up', 'its', 'it', 'as', 'at', 'from', 'no']);

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

/**
 * Lines in `content` that call an approver unknown about an item the material
 * records as authorized: same figure, or at least three shared words. Each
 * comes back with the source sentence that records the approval.
 */
export function missedApprovals(content: string, sources: readonly string[]): { line: string; source: string }[] {
  const approving = sources.flatMap(sentences).filter((s) => APPROVING.test(s) && !NEGATED.test(s) && (approversNamed(s).length || rolesNamed(s).length));
  const out: { line: string; source: string }[] = [];
  // A line, not a sentence: a decision log puts the item and "Approver:
  // unknown" in one row, with a full stop between them.
  for (const line of content.replace(/\\n/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    if (!UNKNOWN_APPROVER.test(line)) continue;
    const figures = new Set((line.match(FIGURE) ?? []).map((f) => f.replace(/,/g, '')).filter((f) => f.length >= 2));
    const mine = words(line);
    const source = approving.find((s) => {
      if ((s.match(FIGURE) ?? []).some((f) => figures.has(f.replace(/,/g, '')))) return true;
      let shared = 0;
      for (const w of words(s)) if (mine.has(w)) shared += 1;
      return shared >= 3;
    });
    if (source) out.push({ line: line.length > 240 ? `${line.slice(0, 239).trimEnd()}…` : line, source: source.slice(0, 240) });
  }
  return out;
}

/** The project's own material: never another stage, which a model wrote. */
export function approverSources(
  project: Pick<Project, 'objective' | 'constraints' | 'audience' | 'output_format' | 'context' | 'facts'>
): string[] {
  return [project.objective, project.constraints, project.audience, project.output_format, project.context ?? '', ...currentFacts(project.facts).map((f) => f.statement)].filter(Boolean);
}

export const UNSUPPORTED_APPROVERS = 'Unsupported approver';

export const MISSED_APPROVER = 'Approver on record';

/** The findings, or none: one naming the unsupported approvers, one per approval called unknown that the project records. */
export function approverFindings(content: string, sources: readonly string[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const names = unsupportedApprovers(content, sources);
  if (names.length) {
    out.push({
      id: 'unsupported-approvers',
      category: UNSUPPORTED_APPROVERS,
      summary: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} named as approving something, but nothing in the project says ${names.length === 1 ? 'that approver' : 'they'} approved anything.`,
      suggested_change: 'Name an approver only where the project material names that person or body as approving that item; otherwise write "approver not recorded".',
    });
  }
  missedApprovals(content, sources).forEach(({ line, source }, i) => {
    out.push({
      id: `missed-approver-${i + 1}`,
      category: MISSED_APPROVER,
      summary: `"${line}" says the approver is not known, but the project records the authorization: "${source}"`,
      suggested_change: 'Name the approver the project records for this item — a person or a body such as the board or the CEO.',
    });
  });
  return out;
}
