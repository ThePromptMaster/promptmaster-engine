/**
 * When the Go loop acts, pauses or stops (PM-17, PM-18, PM-25). Pure.
 *
 * Everything that must not depend on a model's judgement is decided here,
 * before or instead of asking one:
 *
 *   - which moves are even offered (the planner cannot choose outside them);
 *   - `preempt`, run before every planner call — budget, a finished or blocked
 *     project, a missing objective, a loop making no progress, repeated
 *     failure — so none of those costs a model call to notice;
 *   - `shouldPause`, which is the execution policy: Guided pauses before every
 *     move, Checkpoint before important ones, Autonomous only when the model
 *     itself asks the user something. The model can escalate a move to a
 *     decision (needs_user_decision) but never de-escalate one: importance
 *     comes from the registry, not from the response.
 */

import { stageDrafts } from '@/lib/workflow/stage-artifact';
import { nextSuggestedStage } from '@/lib/workflow/engine';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentRunStatus, AgentStep, ExecutionPolicy } from '@/types/agent';
import { actionFor } from './actions';
import type { StageFacts } from './facts';

export const DEFAULT_BUDGET_STEPS = 12;
/** The same move on the same stage this many times running is not progress. */
export const NO_PROGRESS_REPEATS = 3;
export const MAX_CONSECUTIVE_FAILURES = 2;

/** Which tools a run can actually call. Nothing retrieves literature yet (B0). */
export interface AgentTools {
  literature: boolean;
}

export const NO_TOOLS: AgentTools = { literature: false };

export function allowedActions(
  template: WorkflowTemplate,
  state: WorkflowState,
  stage: StageDefinition,
  stageHasDraft: boolean,
  tools: AgentTools = NO_TOOLS,
  facts: StageFacts = {}
): string[] {
  const keys: string[] = [];
  if (template.key === 'research') {
    keys.push(
      'derive', 'prove', 'simplify', 'limiting_case', 'try_contradiction', 'run_computation',
      'falsify_hypothesis', 'compare_alternatives', 'update_assumptions'
    );
    // A move the run cannot perform is not offered: every Research run used to
    // be able to walk into "no search tool is connected" and stop there
    // (Sean, 28 Sep, Research note).
    if (tools.literature) keys.push('check_literature');
  }
  if (stageDrafts(stage)) {
    keys.push(stageHasDraft ? 'evaluate_stage' : 'draft_stage');
    if (stageHasDraft) keys.push('revise_stage');
    if (stageHasDraft && facts.evaluationFindings?.aboutHead && facts.evaluationFindings.count > 0) keys.push('apply_findings');
  }
  // B2b: the stage's own work, offered only while its preconditions hold —
  // and never over an existing outline, which is the user's editor.
  if (stage.renderer === 'outline' && facts.outline && facts.outline.namedSections === 0) keys.push('generate_outline');
  // B3: only the routine rows; a table with none left is the user's.
  if (facts.review && facts.review.routine.length > 0) keys.push('triage_findings');
  if (stage.renderer === 'long_form' && facts.manuscript && facts.manuscript.pendingJobs.length === 0) {
    const m = facts.manuscript;
    if (!m.brief && m.approvedOutlineVersionId && m.total > 0 && m.complete < m.total) keys.push('draft_sections');
    if (m.brief && m.complete > 0 && m.revisedInStage < m.complete) keys.push('revise_sections');
  }
  if (nextSuggestedStage(template, state)) keys.push('advance_stage');
  keys.push('mark_blocked', 'request_user_decision', 'declare_objective_complete');
  return keys;
}

export interface Preemption {
  status: Exclude<AgentRunStatus, 'running'>;
  reason: string;
}

export function preempt(input: {
  state: WorkflowState;
  objective: string;
  stepsUsed: number;
  budgetSteps: number;
  steps: readonly AgentStep[];
}): Preemption | null {
  const { state, objective, stepsUsed, budgetSteps, steps } = input;
  if (state.project_status === 'finalized') {
    return { status: 'completed', reason: 'The project is finished.' };
  }
  if (!objective.trim()) {
    return { status: 'awaiting_decision', reason: 'The project has no objective yet. Set one, then press Go.' };
  }
  const current = state.stages[state.current_stage_id];
  if (current?.status === 'blocked') {
    const why = (current.blocked?.reason ?? 'no reason given').replace(/[.\s]+$/, '');
    return { status: 'blocked', reason: `This stage is marked stuck: ${why}. Clear that, or skip it, to let Go continue.` };
  }
  if (stepsUsed >= budgetSteps) {
    return { status: 'budget_exhausted', reason: `Used all ${budgetSteps} steps of this run's budget.` };
  }
  const finished = steps.filter((s) => s.status !== 'running' && s.status !== 'awaiting_decision');
  const tail = finished.slice(-MAX_CONSECUTIVE_FAILURES);
  if (tail.length === MAX_CONSECUTIVE_FAILURES && tail.every((s) => s.status === 'failed')) {
    return { status: 'failed', reason: `The last ${MAX_CONSECUTIVE_FAILURES} steps failed. Stopping rather than retrying blind.` };
  }
  if (noProgress(finished)) {
    const last = finished.at(-1)!;
    return {
      status: 'blocked',
      reason: `"${actionFor(last.action_key)?.label ?? last.action_key}" was chosen ${NO_PROGRESS_REPEATS} times in a row on this stage without moving on. It needs your direction.`,
    };
  }
  return null;
}

export function noProgress(finished: readonly AgentStep[]): boolean {
  const tail = finished.slice(-NO_PROGRESS_REPEATS);
  if (tail.length < NO_PROGRESS_REPEATS) return false;
  return tail.every((s) => s.action_key === tail[0].action_key && s.stage_id === tail[0].stage_id);
}

/**
 * Steps a move will use. A computation is two — the run and the
 * interpretation that follows it without a planner call — and is only started
 * when both fit, so the budget is a cap rather than a suggestion (a real run
 * ended at 26 of 25 before this).
 */
export function stepCost(actionKey: string): number {
  return actionKey === 'run_computation' ? 2 : 1;
}

export function fitsBudget(actionKey: string, stepsUsed: number, budgetSteps: number): boolean {
  return stepsUsed + stepCost(actionKey) <= budgetSteps;
}

export function isImportant(actionKey: string, needsUserDecision: boolean): boolean {
  return needsUserDecision || Boolean(actionFor(actionKey)?.important);
}

/** Stop for the user's approval before performing this move? */
export function shouldPause(policy: ExecutionPolicy, actionKey: string, needsUserDecision: boolean): boolean {
  if (policy === 'guided') return true;
  if (policy === 'checkpoint') return isImportant(actionKey, needsUserDecision);
  return needsUserDecision;
}

/**
 * Stage moves an approved or autonomous run records. Under Guided and
 * Checkpoint the user approved the move, so it is theirs (actor 'user'); only
 * Autonomous records it as the run acting, which the database then checks
 * against the run's accepted authorization.
 */
export function stageMoveActor(policy: ExecutionPolicy, approvedByUser: boolean): 'user' | 'system' {
  return approvedByUser || policy !== 'autonomous' ? 'user' : 'system';
}

/**
 * A move proposed before the stage last changed — a newer version, or a newer
 * check — was reasoned about a state that no longer exists. Its "why" may now
 * be false ("the current issue is stage drift", after the drift was fixed), so
 * it is shown as outdated rather than offered as the next move (PM-23).
 */
export function plannedBeforeLatestChange(
  step: Pick<AgentStep, 'started_at'>,
  changedAt: readonly (string | null | undefined)[],
): boolean {
  const planned = Date.parse(step.started_at);
  if (Number.isNaN(planned)) return false;
  return changedAt.some((t) => {
    const at = t ? Date.parse(t) : NaN;
    return !Number.isNaN(at) && at > planned;
  });
}
