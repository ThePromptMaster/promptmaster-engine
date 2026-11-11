/**
 * The final check on a one-stage project's draft (11 Nov). Pure.
 *
 * A client, 8 Nov: "Please include final-answer accuracy in this review,
 * alongside how much process the task needs." The check that reads a finished
 * text against what the user supplied ran only inside a Go run, and a one-stage
 * project has no Go, so its draft was never checked unless the user pressed
 * Check. Now the draft is checked once when it is written, corrected once when
 * the check finds something, and checked again. The earlier version is kept.
 */

import { isSaved } from './labels';
import type { WorkflowTemplate } from './types';

/** Starts the change summary of the version this check writes, and marks it. */
export const FINAL_CHECK_SUMMARY = 'Final check:';

/** Decided by the workflow's shape, never by which workflow it is. */
export function hasFinalCheckOfItsOwn(template: Pick<WorkflowTemplate, 'stages'>): boolean {
  return template.stages.length === 1 && template.stages[0].renderer === 'prose';
}

interface CheckedVersion {
  id: string;
  content: string;
  source_operation?: string | null;
  finish_reason?: string | null;
}

/**
 * A draft the model wrote, whole. Not one the user edited or asked to be
 * changed (theirs to keep as it is), not one cut off, and not one this check
 * already saw.
 */
export function wantsFinalCheck(version: CheckedVersion | null | undefined, seen: ReadonlySet<string>): version is CheckedVersion {
  if (!version || seen.has(version.id) || !version.content.trim()) return false;
  if (version.finish_reason === 'length') return false;
  return !isSaved(version.source_operation);
}

export interface CheckFound {
  contradictions: { rule_quote: string; conflicts_quote: string; problem: string; fix: string }[];
}

/** One line per issue, as the correction is told it and as the page shows it. */
export function checkIssues(res: CheckFound): string[] {
  return res.contradictions
    .filter((c) => c.problem.trim())
    .map((c) => `${c.problem.trim()}${c.rule_quote.trim() ? ` Passage: "${c.rule_quote.trim()}".` : ''}${c.fix.trim() ? ` Fix: ${c.fix.trim()}` : ''}`);
}

export function repairInstruction(issues: readonly string[]): string {
  return (
    'A check of this text against what the user supplied found the points below. Correct each one where the text raises it, ' +
    'and change nothing else: keep every other sentence, figure, table and heading as it is.\n' +
    issues.map((i) => `- ${i}`).join('\n')
  );
}

export function repairSummary(issues: readonly string[]): string {
  return `${FINAL_CHECK_SUMMARY} corrected ${issues.length} ${issues.length === 1 ? 'point' : 'points'} — ${issues.join(' · ')}`.slice(0, 1000);
}

export type FinalCheckState =
  | { status: 'checking' }
  | { status: 'clean' }
  /** Corrected, and the check found nothing more. */
  | { status: 'corrected'; fixed: string[] }
  /** Found and not settled: shown for the user to decide. */
  | { status: 'open'; fixed: string[]; left: string[] }
  | { status: 'failed' };
