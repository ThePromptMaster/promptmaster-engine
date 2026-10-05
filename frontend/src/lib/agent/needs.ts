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
import type { InputsChange } from '@/lib/workflow/stage-inputs';

type Need =
  | { kind: 'set_objective' }
  | { kind: 'unblock_stage'; stageId: string; reason: string; blockKind: string }
  | { kind: 'approve_outline'; stageId: string; versionNumber: number | null; unsavedDraft: boolean }
  | { kind: 'tick_criterion'; stageId: string; criterionId: string; label: string; hint?: string }
  | { kind: 'answer_question'; question: string }
  | { kind: 'wait_for_jobs'; stageId: string; pending: number; complete: number; total: number }
  | { kind: 'continue_budget'; budgetSteps: number }
  | { kind: 'large_job'; stageId: string; sections: number }
  | { kind: 'triage_findings'; stageId: string; count: number }
  /** Go thinks this stage is not the best next move; skipping it is the user's call. */
  | { kind: 'skip_stage'; stageId: string; reason: string }
  /** Go's proposal to start another round of a looping workflow; the user starts it. */
  | { kind: 'next_round'; stageId: string; toStageId: string; reason: string }
  /** An outcome table's rows (claims, runs…) are all the user's to decide. */
  | { kind: 'decide_rows'; stageId: string; count: number; itemLabel: string };

/**
 * `onStage` is the stage the project was on when the run stopped. A request
 * raised on a stage the project has since left is not shown (1 Oct, item 1:
 * "Go sometimes continued to display an old human request after the project
 * appeared to have advanced").
 */
export type NeedsUser = Need & { onStage?: string };

/** What the run says once the user has done what it asked for, themselves. */
export const NEED_CLEARED = 'That is done. Press Resume and I will carry on.';
/**
 * …and once the project has left the stage the request was about. Nothing
 * was done: "That is done" over findings the user chose to leave undecided
 * was simply untrue (production pass, 2026-10-01).
 */
export const NEED_MOVED_ON = 'The project has moved on from the stage I was waiting on. Press Resume and I will carry on from here.';

/** The button on a request that is settled row by row: it takes the user to the rows. */
export const SHOW_TABLE = 'Go to the table';

/**
 * Requests whose button shows the way rather than doing the thing: deciding a
 * row is several choices, each the user's, so no one click can stand for them.
 */
export function needIsDecidedOnStage(need: Pick<NeedsUser, 'kind'>): boolean {
  return need.kind === 'decide_rows' || need.kind === 'triage_findings';
}

/** Whether a stop reason is one of the two "nothing is asked of you now" notes. */
export function isClearedNote(reason: string | null | undefined): boolean {
  return reason === NEED_CLEARED || reason === NEED_MOVED_ON;
}

/**
 * Moves that produce the stage's own work. With none of these left and only
 * boxes the user ticks unmet, the next move is the user's.
 *
 * The research moves (Compare alternatives, Derive, …) are not here: they
 * reason about the work but cannot tick an approval. Counting them let a
 * custom workflow's Evidence stage, whose only open item was "I approve this
 * evidence base", run Compare alternatives three times and stop on the
 * repeat instead of at the approval (4 Oct). Revise is not here either:
 * revising cannot tick a box (Positioning, 2026-09-29).
 */
const STAGE_WORK_MOVES = new Set(['draft_stage', 'generate_outline', 'draft_sections', 'revise_sections', 'triage_findings']);

/**
 * Everything still open on the stage is a box only the user ticks, and at
 * least one of them is required. An optional automatic item still open
 * ("three works verified") is work Go can do, so it is not the boundary yet.
 */
export function onlyApprovalLeft(stageEvaluation: StageEvaluation): boolean {
  const blockingUnmet = stageEvaluation.unmet.filter((c) => c.blocking);
  return blockingUnmet.length > 0 && stageEvaluation.unmet.every((c) => c.manual);
}

/** Moves that reason about the work; they cannot tick an approval. */
const REASONING_MOVES = new Set([
  'derive', 'prove', 'simplify', 'limiting_case', 'try_contradiction', 'run_computation',
  'falsify_hypothesis', 'compare_alternatives', 'check_literature', 'update_assumptions',
]);

export interface RequiredMove {
  key: string;
  rationale: string;
  expected: string;
}

/**
 * What the stage itself still requires, in order, before anything optional:
 * finish a cut-off draft; then — once only the user's approval is left —
 * apply the check's findings and check again, so the user is asked to approve
 * work that has had its fixes (Sean, 4 Oct: "finish the incomplete artifact;
 * apply the stage-check findings it can handle; re-check; if only a human
 * approval remains, stop and ask me; only then choose optional actions").
 *
 * Pure. Only moves in `allowed` are returned, so the polish cap still bounds
 * apply and check.
 */
export function requiredWork(input: {
  stage: StageDefinition;
  facts: StageFacts;
  stageEvaluation: StageEvaluation;
  allowed: readonly string[];
}): RequiredMove | null {
  const { stage, facts, stageEvaluation, allowed } = input;
  const can = (k: string) => allowed.includes(k);

  if (facts.draft?.truncated && can('continue_writing')) {
    return {
      key: 'continue_writing',
      rationale: `The ${stage.label} draft was cut off before it finished; finishing it comes before anything else.`,
      expected: 'The draft continues from where it stopped, as a new version.',
    };
  }

  if (!onlyApprovalLeft(stageEvaluation) || !facts.draft) return null;

  const findings = facts.evaluationFindings;
  if (findings?.aboutHead && findings.count > 0 && can('apply_findings')) {
    return {
      key: 'apply_findings',
      rationale: `Only your approval is left on ${stage.label}, and the stage check raised ${findings.count} finding${findings.count === 1 ? '' : 's'} Go can fix first.`,
      expected: 'A new version with the findings applied.',
    };
  }
  if (!facts.draft.checked && can('evaluate_stage')) {
    return {
      key: 'evaluate_stage',
      rationale: `Only your approval is left on ${stage.label}; checking this version first, so you approve work that has been checked.`,
      expected: 'A check of the current version against the objective.',
    };
  }
  return null;
}

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
  /**
   * How many more computations the run may try against this stage's table:
   * above zero only when the table's rows are things a sandbox run can carry
   * out, the project holds data, and the run has not yet tried once per row.
   */
  runAttemptsLeft?: number;
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
  // …unless they are runs and the data to carry them out is here: then a
  // computation can settle a row, and stopping first would leave the data unused.
  const canRun = Boolean(facts.review?.outcome && facts.review.schema.execution && (input.runAttemptsLeft ?? 0) > 0);
  if (facts.review && facts.review.material.length > 0 && facts.review.routine.length === 0 && !canRun) {
    return facts.review.outcome
      ? { kind: 'decide_rows', stageId: stage.id, count: facts.review.material.length, itemLabel: facts.review.schema.itemLabel }
      : { kind: 'triage_findings', stageId: stage.id, count: facts.review.material.length };
  }

  // Everything left to do here is a box only the user ticks. A revise move
  // does not count as work left: revising cannot tick a box, and counting
  // it let an autonomous run move past Positioning with its one required
  // box unticked instead of stopping here (production pass, 2026-09-29).
  const blockingUnmet = stageEvaluation.unmet.filter((c) => c.blocking);
  const workLeft =
    allowed.some((k) => STAGE_WORK_MOVES.has(k)) ||
    // Computations the project's data can still carry out are work, not reasoning.
    (allowed.includes('run_computation') && (input.runAttemptsLeft ?? 0) > 0) ||
    // An optional automatic item still open is something a lookup or a run may settle.
    (!onlyApprovalLeft(stageEvaluation) && allowed.some((k) => REASONING_MOVES.has(k))) ||
    requiredWork({ stage, facts, stageEvaluation, allowed }) !== null;
  if (blockingUnmet.length > 0 && blockingUnmet.every((c) => c.manual) && !workLeft) {
    const c = blockingUnmet[0];
    return { kind: 'tick_criterion', stageId: stage.id, criterionId: c.id, label: c.label, ...(c.hint ? { hint: c.hint } : {}) };
  }

  return null;
}

/**
 * Whether a stop the run recorded still describes the project. Pure.
 *
 * The request was written when the run stopped and never looked at again: the
 * user approved the outline, ticked the box or decided the rows on the stage
 * itself, and the card went on asking for it. Resume then re-read the project
 * and either carried on or stopped for something else — which is the
 * "sometimes it continues, sometimes nothing happens" of item 22.
 */
export function needStillHolds(
  need: NeedsUser,
  input: Parameters<typeof needsUser>[0] & { objective: string; currentStageId: string }
): boolean {
  // Another window is the user's click whatever stage the project is on.
  if (need.kind === 'continue_budget') return true;
  if (need.onStage && need.onStage !== input.currentStageId) return false;
  switch (need.kind) {
    case 'set_objective':
      return !input.objective.trim();
    case 'answer_question':
    case 'skip_stage':
    case 'next_round':
      return true;
    case 'unblock_stage':
      return input.state.stages[need.stageId]?.status === 'blocked';
    case 'wait_for_jobs':
      return (input.facts.manuscript?.pendingJobs.length ?? 0) > 0;
    case 'tick_criterion':
      // Asked for directly: the box is either still unticked or it is not.
      // (Going back through needsUser would drop a request raised while other
      // moves were still on offer — see the 'complete' performer.)
      return input.stageEvaluation.unmet.some((c) => c.id === need.criterionId);
    default: {
      const now = needsUser(input);
      return Boolean(now && now.kind === need.kind);
    }
  }
}

/**
 * What the card for a stuck stage can do. Each is a different thing. `clear`
 * lifts the block and leaves the user on the stage — what the More menu's
 * "Continue this stage" does — without Go resuming.
 */
export type StuckOption = 'resume' | 'add_data' | 'skip' | 'retry' | 'clear';

/** At most this many ways forward on a stuck card (2 Oct screenshots: five was too many). */
export const STUCK_OPTIONS_MAX = 3;

/** What is true of the project now, for a request whose wording depends on it. */
export interface NeedContext {
  /** Whether the stuck stage's inputs changed since it was marked stuck; null when that was not recorded. */
  blockInputs?: InputsChange | null;
  /** The stuck stage may be skipped. */
  canSkip?: boolean;
  /**
   * The exact label of the stage bar's own transition button, from the
   * controls registry (`stageControls`), so the card can point to it in the
   * words that are on the page. Null when there is none.
   */
  advanceControl?: string | null;
  /** The current stage's approvals the user has not given yet (manual criteria, unticked). */
  openApprovals?: { id: string; label: string }[];
}

const norm = (text: string) =>
  text.toLowerCase().replace(/[\u2018\u2019\u201c\u201d"'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The approvals a question from Go is asking the user to give.
 *
 * Go asks for an approval in its own words and quotes the requirement — on
 * production (4 Oct) it asked "If yes, use 'I agree this says what is not yet
 * known…'", and the card offered only a text box: the client's "it asks me to
 * tick something and there is no tick". A requirement whose label the question
 * contains is offered as the tick itself. Matched on the label, never guessed.
 */
export function approvalsAskedFor(
  question: string,
  approvals: readonly { id: string; label: string }[] = []
): { id: string; label: string }[] {
  const q = norm(question);
  return approvals.filter((a) => {
    const label = norm(a.label);
    return label.length >= 12 && q.includes(label);
  });
}

/**
 * A stuck stage, described honestly (2 Oct, item 9), with at most three ways
 * forward (2 Oct screenshots: "Skip for now", "Try again without changes",
 * "Resume with what has changed", "Continue this stage" and "Override and
 * continue" were on one screen, and the client could not tell which to pick).
 *
 * The card says whether anything changed. One option leads by situation:
 * resuming when something changed, adding the data when data is what is
 * missing, trying again otherwise. Skipping is offered where the stage
 * allows it. The last is always the plain way out — clear the block and
 * carry on by hand. Overriding stays on the stage bar, and the footer names
 * that button in the words that are on the page.
 */
function describeStuck(
  need: Extract<NeedsUser, { kind: 'unblock_stage' }>,
  stage: string,
  ctx: NeedContext
): { message: string; action: string; options: { id: StuckOption; label: string }[]; footer?: string } {
  const why = `${stage} is marked stuck${need.reason ? `: ${need.reason.replace(/[.\s]+$/, '')}` : ''}.`;
  const skip = ctx.canSkip ? [{ id: 'skip' as const, label: `Skip ${stage} for now` }] : [];
  const clear = { id: 'clear' as const, label: 'Continue this stage by hand' };
  const footer = ctx.advanceControl
    ? `To move on with this still open, use “${ctx.advanceControl}” under More at the bottom of the stage; it asks for your reason.`
    : undefined;
  const lead = ctx.blockInputs?.changed
    ? { id: 'resume' as const, label: 'Resume with what has changed' }
    : need.blockKind === 'data_missing'
      ? { id: 'add_data' as const, label: 'Add the missing data' }
      : { id: 'retry' as const, label: 'Try again' };
  const options = [lead, ...skip, clear].slice(0, STUCK_OPTIONS_MAX);
  const since = ctx.blockInputs?.changed
    ? ` Since then, ${ctx.blockInputs.what.join(' and ')}.`
    : ctx.blockInputs
      ? ' Nothing in the project has changed since, so trying again will most likely stop at the same place.'
      : ' I need that cleared before I can continue.';
  return { message: `${why}${since}`, action: options[0].label, options, footer };
}

/**
 * The sentence the card shows, and the label of the one button that clears it
 * (null: no button, just Resume). A stuck stage has several `options`; the
 * first is the one `action` names.
 */
export function describeNeed(
  need: NeedsUser,
  stageLabel: (id: string) => string,
  ctx: NeedContext = {}
): { message: string; action: string | null; options?: { id: StuckOption; label: string }[]; footer?: string } {
  switch (need.kind) {
    case 'set_objective':
      return { message: 'I need an objective before I can choose a move. Set one above.', action: null };
    case 'unblock_stage':
      return describeStuck(need, stageLabel(need.stageId), ctx);
    case 'approve_outline':
      return need.unsavedDraft
        ? { message: `I need your approval of the outline on ${stageLabel(need.stageId)} before I can continue. It has edits that are not saved yet.`, action: 'Save and approve the outline' }
        : {
            message: `I need your approval of ${need.versionNumber ? `outline version ${need.versionNumber}` : 'the outline'} before I can continue.`,
            action: 'Approve the outline',
          };
    case 'tick_criterion':
      return {
        message: `I need your approval before I can continue: "${need.label}".${need.hint ? ` ${need.hint}` : ''}`,
        action: 'Approve and resume',
      };
    case 'answer_question':
      return { message: need.question, action: null };
    case 'skip_stage':
      return {
        message: `${stageLabel(need.stageId)} is normally next, but I would skip it for now. ${need.reason.replace(/\s+$/, '')} It is your call, and a skipped stage can be reopened later.`,
        action: `Skip ${stageLabel(need.stageId)} for now`,
      };
    case 'next_round':
      return {
        message: `This round is done. ${need.reason.replace(/\s+$/, '')} Start the next round from ${stageLabel(need.toStageId)} when you are ready — or stop here and write it up.`,
        action: `Start the next round from ${stageLabel(need.toStageId)}`,
      };
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
        message: `${need.count} ${need.count === 1 ? need.itemLabel : `${need.itemLabel}s`} ${need.count === 1 ? 'is' : 'are'} waiting for your decision — only you can settle ${need.count === 1 ? 'it' : 'them'}. Set a status on each in the table below — that is how a check stage works.`,
        action: SHOW_TABLE,
      };
    case 'triage_findings':
      return {
        message: `${need.count} finding${need.count === 1 ? '' : 's'} would change the work, so ${need.count === 1 ? 'it needs' : 'they need'} your decision. Accept or reject each in the table below — that is how a check stage works.`,
        action: SHOW_TABLE,
      };
  }
}
