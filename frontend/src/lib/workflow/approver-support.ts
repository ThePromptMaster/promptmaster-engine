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
 */

import type { AuditFinding } from '@/types';
import type { Project } from '@/types/project';
import { currentFacts } from './facts';

const NAME = String.raw`([A-Z][a-z]{2,})`;
const PATTERNS = [
  new RegExp(String.raw`\b(?:approved|authori[sz]ed|signed off)\s+by\s+(?:sponsor\s+)?${NAME}`, 'g'),
  new RegExp(String.raw`\b${NAME}\s+(?:has\s+|had\s+)?(?:approved|authori[sz]ed|signed off)\b`, 'g'),
  new RegExp(String.raw`\b${NAME}['’]s\s+(?:approval|authori[sz]ation|sign-?off)\b`, 'g'),
  new RegExp(String.raw`\bapprover\s*[:\-–—]\s*${NAME}`, 'gi'),
];
/** Capitalised words that are not people. */
const NOT_NAMES = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'The', 'This', 'That', 'Not', 'Never', 'Was', 'Has', 'Have', 'Had', 'Been', 'Budget', 'Launch', 'Date', 'Sponsor',
  'Change', 'Changes', 'Plan', 'Project', 'Nobody', 'None', 'Who', 'Which', 'Already', 'Formally', 'Also', 'Since',
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

/** The names in `content` given as approvers whom none of `sources` names as approving anything. */
export function unsupportedApprovers(content: string, sources: readonly string[]): string[] {
  const approving = sources.flatMap(sentences).filter((s) => APPROVING.test(s));
  return approversNamed(content).filter((name) => !approving.some((s) => new RegExp(String.raw`\b${name}\b`).test(s)));
}

/** The project's own material: never another stage, which a model wrote. */
export function approverSources(
  project: Pick<Project, 'objective' | 'constraints' | 'audience' | 'output_format' | 'context' | 'facts'>
): string[] {
  return [project.objective, project.constraints, project.audience, project.output_format, project.context ?? '', ...currentFacts(project.facts).map((f) => f.statement)].filter(Boolean);
}

export const UNSUPPORTED_APPROVERS = 'Unsupported approver';

/** The finding, or none: one per check, naming the people. */
export function approverFindings(content: string, sources: readonly string[]): AuditFinding[] {
  const names = unsupportedApprovers(content, sources);
  if (!names.length) return [];
  return [{
    id: 'unsupported-approvers',
    category: UNSUPPORTED_APPROVERS,
    summary: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} named as approving something, but nothing in the project says ${names.length === 1 ? 'that person' : 'they'} approved anything.`,
    suggested_change: 'Name an approver only where the project material names that person as approving that item; otherwise write "approver not recorded".',
  }];
}
