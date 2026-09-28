/**
 * What Go mode needs from the user before it can go on (B4). Pure.
 *
 * Sean, 28 Sep, item 4: "If Resume cannot continue, I think the interface
 * should tell me very directly: I need you to do this before I can continue.
 * And ideally put that exact action right there." These are the things Go
 * never does itself — approving an outline, unblocking a stage, ticking a box
 * that is the user's to tick, spending another window — stated as data so
 * the panel can render the message and the one button that clears it.
 */

import { isLargeJob } from '@/components/workflow/large-job-warning';
import type { ExecutionPolicy } from '@/types/agent';
import type { StageDefinition, StageEvaluation, WorkflowState } from '@/lib/workflow/types';
import type { StageFacts } from './facts';

export type NeedsUser =
  | { kind: 'set_objective' }
  | { kind: 'unblock_stage'; stageId: string; reason: string; blockKind: string }
  | { kind: 'approve_outline'; stageId: string; versionNumber: number | null; unsavedDraft: boolean }
  | { kind: 'tick_criterion'; stageId: string; criterionId: string; label: string; hint?: string }
  | { kind: 'answer_question'; question: string }
  | { kind: 'wait_for_jobs'; stageId: string; pending: number; complete: number; total: number }
  | { kind: 'continue_budget'; budgetSteps: number }
  | { kind: 'large_job'; stageId: string; sections: number }
  | { kind: 'triage_findings'; stageId: string; count: number }
  /** An outcome table's rows (claims, runs…) are all the user's to decide. */
  | { kind: 'decide_rows'; stageId: string; count: number; itemLabel: string };

/** Moves that change the stage's work; a stage with none left needs the user, not the planner. */
const WORK_MOVES = new Set([
  'draft_stage', 'revise_stage', 'apply_findings', 'generate_outline', 'draft_sections', 'revise_sections', 'triage_findings',
  'derive', 'prove', 'simplify', 'limiting_case', 'try_contradiction', 'run_computation',
  'falsify_hypothesis', 'compare_alternatives', 'check_literature', 'update_assumptions',
]);

/**
 * Decide, before the planner is asked, whether the next move is the user's.
 *
 * `outlineStageId` is the stage that holds the outline (Book's Outline stage),
 * so a need raised on the approval or drafting stage points at where the
 * approval happens.
 */
export function needsUser(input: {
  state: WorkflowState;
  stage: StageDefinition;
  facts: StageFacts;
  stageEvaluation: StageEvaluation;
  allowed: readonly string[];
  policy: ExecutionPolicy;
  outlineStageId: string | null;
  /** The user already said "draft them anyway" for this many sections. */
  largeJobAcknowledged?: number | null;
}): NeedsUser | null {
  const { state, stage, facts, stageEvaluation, allowed, policy, outlineStageId } = input;

  const current = state.stages[stage.id];
  if (current?.status === 'blocked') {
    return { kind: 'unblock_stage', stageId: stage.id, reason: current.blocked?.reason ?? '', blockKind: current.blocked?.kind ?? 'needs_decision' };
  }

  // An outline exists but drafting is not bound to it: only the user approves.
  if (facts.outline && facts.outline.namedSections > 0 && !facts.outline.headApproved) {
    return {
      kind: 'approve_outline', stageId: stage.id,
      versionNumber: facts.outline.head?.version_number ?? null, unsavedDraft: facts.outline.unsavedDraft,
    };
  }
  const wantsApproval = stage.exit_criteria.some((c) => c.rule?.type === 'outline_approved');
  const approvalUnmet = stageEvaluation.unmet.some((c) => stage.exit_criteria.find((x) => x.id === c.id)?.rule?.type === 'outline_approved');
  if (wantsApproval && approvalUnmet && outlineStageId) {
    return { kind: 'approve_outline', stageId: outlineStageId, versionNumber: null, unsavedDraft: false };
  }
  if (facts.manuscript && !facts.manuscript.approvedOutlineVersionId && outlineStageId) {
    return { kind: 'approve_outline', stageId: outlineStageId, versionNumber: null, unsavedDraft: false };
  }

  // FR-18: a large drafting run under Autonomous is a spend the user confirms.
  if (policy === 'autonomous' && allowed.includes('draft_sections') && facts.manuscript) {
    const unwritten = facts.manuscript.total - facts.manuscript.complete;
    if (isLargeJob(unwritten) && input.largeJobAcknowledged !== unwritten) {
      return { kind: 'large_job', stageId: stage.id, sections: unwritten };
    }
  }

  // The findings left are the ones that change the work: the user's call (B3).
  if (facts.review && facts.review.material.length > 0 && facts.review.routine.length === 0) {
    return facts.review.outcome
      ? { kind: 'decide_rows', stageId: stage.id, count: facts.review.material.length, itemLabel: facts.review.schema.itemLabel }
      : { kind: 'triage_findings', stageId: stage.id, count: facts.review.material.length };
  }

  // Everything left to do here is a box only the user ticks.
  const blockingUnmet = stageEvaluation.unmet.filter((c) => c.blocking);
  const workLeft = allowed.some((k) => WORK_MOVES.has(k));
  if (blockingUnmet.length > 0 && blockingUnmet.every((c) => c.manual) && !workLeft) {
    const c = blockingUnmet[0];
    return { kind: 'tick_criterion', stageId: stage.id, criterionId: c.id, label: c.label, ...(c.hint ? { hint: c.hint } : {}) };
  }

  return null;
}

/** The sentence the card shows, and the label of the one button that clears it (null: no button, just Resume). */
export function describeNeed(need: NeedsUser, stageLabel: (id: string) => string): { message: string; action: string | null } {
  switch (need.kind) {
    case 'set_objective':
      return { message: 'I need an objective before I can choose a move. Set one above.', action: null };
    case 'unblock_stage':
      return {
        message: `${stageLabel(need.stageId)} is marked stuck${need.reason ? `: ${need.reason.replace(/[.\s]+$/, '')}` : ''}. I need that cleared before I can continue.`,
        action: 'Continue the stage and resume',
      };
    case 'approve_outline':
      return need.unsavedDraft
        ? { message: `I need your approval of the outline before I can continue — it has unsaved edits, so save and approve it on ${stageLabel(need.stageId)}.`, action: null }
        : {
            message: `I need your approval of ${need.versionNumber ? `outline version ${need.versionNumber}` : 'the outline'} before I can continue.`,
            action: 'Approve the outline',
          };
    case 'tick_criterion':
      return {
        message: `Only you can confirm "${need.label}"${need.hint ? ` — ${need.hint}` : ''}. I need that before I can continue.`,
        action: 'Confirm and resume',
      };
    case 'answer_question':
      return { message: need.question, action: null };
    case 'wait_for_jobs':
      return {
        message: `${need.pending} section${need.pending === 1 ? ' is' : 's are'} still being written (${need.complete} of ${need.total} done). I can keep waiting.`,
        action: 'Keep waiting',
      };
    case 'continue_budget':
      return {
        message: `This window of ${need.budgetSteps} steps is used up and the work is not done.`,
        action: `Continue for ${need.budgetSteps} more steps`,
      };
    case 'large_job':
      return {
        message: `Drafting ${need.sections} sections is a large run. I need your say-so before spending that.`,
        action: `Draft ${need.sections} sections anyway`,
      };
    case 'decide_rows':
      return {
        message: `${need.count} ${need.count === 1 ? need.itemLabel : `${need.itemLabel}s`} ${need.count === 1 ? 'is' : 'are'} waiting for your decision — only you can settle ${need.count === 1 ? 'it' : 'them'}. Decide in the table below.`,
        action: null,
      };
    case 'triage_findings':
      return {
        message: `${need.count} finding${need.count === 1 ? '' : 's'} would change the work, so ${need.count === 1 ? 'it needs' : 'they need'} your decision. Decide in the table below.`,
        action: null,
      };
  }
}
