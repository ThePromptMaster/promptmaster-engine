/**
 * The audit Go makes before it interrupts the user (Q1b). Pure.
 *
 * Sean, 9 Oct: "Before interrupting the user, Go should assess: What
 * specifically prevents the next action? Can it resolve the issue using
 * available sources, tools, or checks? Can another useful part of the
 * investigation proceed independently? Does proceeding require a human
 * decision or expert judgment?"
 *
 * The work Go is required to do on a stage (`requiredWork`, `staleRepair`)
 * and the stops `needsUser` makes are already decided in code before the
 * planner is asked. What reaches this audit is the planner's own choice to
 * ask a question. When the stage it is on is already finished — its blocking
 * criteria met — the question does not hold the work up: under Autonomous
 * with routine decisions handed to Go, the question is set aside, recorded,
 * and the work moves on. It is asked once the work has nowhere further to go,
 * or at the end, in the run's account. A second question on the same stage
 * in the same window is asked: the audit overrides a planner once, not
 * forever.
 */

import type { ExecutionPolicy } from '@/types/agent';
import type { RoutineDecisions } from '@/types/project';

export interface StopAudit {
  /** What stops the next action, in the planner's words. */
  blocker: string;
  /** What was checked before deciding, one line each. */
  checked: string[];
  /** The work that goes on instead, when there is some. */
  proceedWith: string | null;
}

export interface AuditInput {
  question: string;
  stageLabel: string;
  nextStageLabel: string | null;
  allowed: readonly string[];
  /** The stage's blocking criteria are all met. */
  canAdvance: boolean;
  policy: ExecutionPolicy;
  routine: RoutineDecisions;
  /** A question was already set aside on this stage in this window. */
  setAsideBefore: boolean;
  /** The question is about the objective itself, or overturns something the user decided. */
  touchesObjective: boolean;
}

export interface AuditResult {
  audit: StopAudit;
  /** The move made instead of asking, or null: ask. */
  instead: { key: string; rationale: string; expected: string } | null;
}

/** Wording that marks a question about what the project is for, or about the user's own decisions. */
const OBJECTIVE_WORDS = /\b(objective|goal|scope|requirement|relax|change (?:the|your) (?:plan|aim)|which (?:one|option) do you (?:want|prefer)|approve|your decision)\b/i;

export function touchesObjective(question: string): boolean {
  return OBJECTIVE_WORDS.test(question);
}

export function auditStop(input: AuditInput): AuditResult {
  const blocker = input.question.trim() || 'A question for you.';
  const checked: string[] = [
    'Required work on this stage (a draft to finish, sources to look up, runs PromptMaster can carry out, a repair): none left.',
  ];
  const canMoveOn = input.canAdvance && input.allowed.includes('advance_stage') && Boolean(input.nextStageLabel);
  checked.push(
    canMoveOn
      ? `${input.stageLabel} has every requirement met, so the next stage (${input.nextStageLabel}) can proceed without this answer.`
      : `${input.stageLabel} cannot be finished without an answer.`
  );

  const delegated = input.policy === 'autonomous' && input.routine === 'handle';
  if (!delegated) checked.push('Routine decisions are not handed to Go in this run, so the question is asked now.');
  if (input.touchesObjective) checked.push('The question is about the objective or a decision of yours, which is yours alone.');
  if (input.setAsideBefore) checked.push('A question on this stage was already set aside in this run; this one is asked.');

  if (canMoveOn && delegated && !input.touchesObjective && !input.setAsideBefore) {
    return {
      audit: { blocker, checked, proceedWith: `Moving on to ${input.nextStageLabel}; the question is kept for you in the run's account.` },
      instead: {
        key: 'advance_stage',
        rationale: `Set aside, not dropped: "${blocker.slice(0, 200)}". ${input.stageLabel} has every requirement met, so the work moves on to ${input.nextStageLabel} and the question stays on record for you.`,
        expected: `${input.nextStageLabel} begins; the question is listed in the run's account.`,
      },
    };
  }
  return { audit: { blocker, checked, proceedWith: null }, instead: null };
}

/** The audit as the lines a stop shows under its question. */
export function describeAudit(audit: StopAudit): string {
  return ['Before asking, I checked:', ...audit.checked.map((c) => `- ${c}`)].join('\n');
}
