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

import { isTriaged, stageDrafts, type StageItem, type StageItemSchema } from '@/lib/workflow/stage-artifact';
import { nextSuggestedStage } from '@/lib/workflow/engine';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { AgentRunStatus, AgentStep, ExecutionPolicy } from '@/types/agent';
import { actionFor, INTERPRET_STEP, USER_ANSWER_STEP } from './actions';
import type { StageFacts } from './facts';

export const DEFAULT_BUDGET_STEPS = 12;
/** The same move on the same stage this many times running is not progress. */
export const NO_PROGRESS_REPEATS = 3;
export const MAX_CONSECUTIVE_FAILURES = 2;
/** This many performed moves in a row that left the project exactly as it was is not progress either. */
export const NO_CHANGE_STEPS = 3;

/**
 * Moving past something a stage requires is an override, and an override is
 * the user's, with their reason (1 Oct, item 8). A run acting on its own
 * authority is not offered the move; under Guided and Checkpoint the user's
 * Approve on the proposed move is the override.
 *
 * The converse too: a stage whose every requirement is met is not stuck. Go
 * marked Critique stuck for "no draft content" while the page said "Nothing
 * on Critique is outstanding — move on to Fact-check", and the two cards sat
 * one above the other (2 Oct, screenshot 2). When the stage can advance the
 * planner moves on, asks, or finishes; the user can still mark it stuck by
 * hand.
 */
export function withoutOverride(allowed: readonly string[], canAdvance: boolean, policy: ExecutionPolicy): string[] {
  return allowed.filter((k) =>
    k === 'advance_stage' ? canAdvance || policy !== 'autonomous'
    : k === 'mark_blocked' ? !canAdvance || !allowed.includes('advance_stage')
    : true
  );
}

/** The automatic steps, in words, for anything that names a step to the user. */
const STEP_WORDS: Record<string, string> = { [INTERPRET_STEP]: 'Interpret the result', [USER_ANSWER_STEP]: 'Your answer' };

/**
 * No computation once every planned run has its result. On a production
 * Research run (3 Oct) one sandbox run settled all eight rows, and Go went on
 * running the computation again — eight tries were budgeted, one per row —
 * instead of moving on to Analysis.
 */
export function withoutSettledRuns(
  allowed: readonly string[],
  review: { items: StageItem[]; schema: StageItemSchema } | undefined
): string[] {
  if (!review?.schema.execution) return [...allowed];
  const open = review.items.filter((i) => !isTriaged(i, review.schema)).length;
  return open > 0 ? [...allowed] : allowed.filter((k) => k !== 'run_computation');
}

/** Moves that polish a stage rather than move the work on. */
export const POLISH_MOVES = ['evaluate_stage', 'apply_findings', 'revise_stage'] as const;
/** Polishing moves on one stage in one run, once it could move on — and at most, whatever. */
export const POLISH_WHEN_READY = 2;
export const POLISH_MAX = 4;

/**
 * Stop polishing a stage that is good enough. On a production Research run
 * (3 Oct) Go spent its whole window on Literature — check, apply, check,
 * revise, check — every step producing a version, so the no-change stop never
 * fired. Once the stage can move on, two polishing moves are enough; four
 * are the most it gets either way. The planner is then left to move on, or
 * to ask.
 */
/**
 * Polishing moves on this stage since the user last gave a direction.
 *
 * The cap is for Go deciding on its own to polish again. A user who answers
 * "revise it so that…" has asked for exactly that move: on production (5 Oct)
 * the cap counted the whole run chain, so after that answer Revise was no
 * longer allowed and Go replied it could not settle on a next step.
 */
export function polishSinceDirection(
  steps: readonly { action_key: string; stage_id?: string | null }[],
  stageId: string
): number {
  const lastAnswer = steps.map((s) => s.action_key).lastIndexOf(USER_ANSWER_STEP);
  return steps
    .slice(lastAnswer + 1)
    .filter((s) => s.stage_id === stageId && (POLISH_MOVES as readonly string[]).includes(s.action_key)).length;
}

export function withoutEndlessPolish(
  allowed: readonly string[],
  polishedHere: number,
  canAdvance: boolean
): string[] {
  const capped = polishedHere >= POLISH_MAX || (canAdvance && polishedHere >= POLISH_WHEN_READY);
  return capped ? allowed.filter((k) => !(POLISH_MOVES as readonly string[]).includes(k)) : [...allowed];
}

/** Which tools a run can actually call. */
export interface AgentTools {
  literature: boolean;
  /** The project has data files the sandbox can read. */
  datasets?: boolean;
}

export const NO_TOOLS: AgentTools = { literature: false };
/** What a run can call today: a literature lookup (OpenAlex) is connected since 2026-10-01, and a topic search of it since 2026-10-02. */
export const LIVE_TOOLS: AgentTools = { literature: true };

/**
 * Whether the stage holds a draft for the work now in hand. Ordinarily any
 * draft; in a workflow that loops, only one written since the stage was last
 * entered — last round's Explore is not this round's, and Go should draft the
 * new round rather than revise the old one.
 */
export function stageHasCurrentDraft(
  template: WorkflowTemplate,
  state: WorkflowState,
  stageId: string,
  head: { content?: string | null; created_at?: string } | undefined
): boolean {
  if (!(head?.content ?? '').trim()) return false;
  if (!template.stages.some((s) => s.transitions.loop_to)) return true;
  const entered = state.stages[stageId]?.entered_at;
  return !entered || !head?.created_at || head.created_at >= entered;
}

export function allowedActions(
  template: WorkflowTemplate,
  state: WorkflowState,
  stage: StageDefinition,
  stageHasDraft: boolean,
  tools: AgentTools = NO_TOOLS,
  facts: StageFacts = {}
): string[] {
  const keys: string[] = [];
  // Research predates the flag; anything else says so on the template.
  if (template.key === 'research' || template.inquiry) {
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
    if (!stageHasDraft) keys.push('draft_stage');
    // A review table, once drafted, is decided row by row — never checked
    // as prose, and never regenerated by Go: on the end-to-end pass of
    // 2026-09-29 an autonomous run checked a fully decided critique table,
    // revised it (wiping every decision) and triaged it again.
    else if (stage.renderer !== 'review') {
      keys.push('evaluate_stage', 'revise_stage');
      if (facts.draft?.truncated) keys.push('continue_writing');
      if (facts.evaluationFindings?.aboutHead && facts.evaluationFindings.count > 0) keys.push('apply_findings');
    }
  }
  // B2b: the stage's own work, offered only while its preconditions hold —
  // and never over an existing outline, which is the user's editor.
  if (facts.outline && facts.outline.namedSections === 0) keys.push('generate_outline');
  // B3: only the routine rows; a table with none left is the user's.
  if (facts.review && facts.review.routine.length > 0) keys.push('triage_findings');
  if (stage.renderer === 'long_form' && facts.manuscript && facts.manuscript.pendingJobs.length === 0) {
    const m = facts.manuscript;
    if (!m.brief && m.approvedOutlineVersionId && m.total > 0 && m.complete < m.total) keys.push('draft_sections');
    if (m.brief && m.complete > 0 && m.revisedInStage < m.complete) keys.push('revise_sections');
  }
  // The order is the template's default; a stage that may be skipped can be
  // proposed for skipping (the user decides). Offered once per stage per run
  // — the loop removes it after a proposal.
  if (stage.transitions.allow_skip && stage.transitions.default_next) keys.push('propose_skip');
  // A round that has produced its question can propose the next one (the user starts it).
  if (stage.transitions.loop_to && stageHasDraft) keys.push('propose_next_round');
  // The stage that closes a round does not move on to the write-up by Go's
  // choice: open-ended work "is going to go on forever" (3 Oct call), and on
  // production Go took the write-up after one round. It proposes the next
  // round; ending the exploration is the user's, from the stage bar.
  // In a workflow that loops, a stage entered again holds last round's draft,
  // which still satisfies its requirements; moving on would carry it into the
  // new round unchanged (production, 4 Oct: Findings and Next question were
  // passed through, and the round could not be proposed). Draft it first.
  const staleRoundDraft =
    template.stages.some((s) => s.transitions.loop_to) && stageDrafts(stage) && !stageHasDraft;
  if (nextSuggestedStage(template, state) && !stage.transitions.loop_to && !staleRoundDraft) keys.push('advance_stage');
  // Nothing is stuck before it has been tried: a stage that drafts and has no
  // draft yet is drafted first. Offered both, the planner on an empty review
  // stage chose "stuck — no draft text" over drafting the review from the
  // manuscript (2 Oct screenshots). Missing data shows itself once the draft
  // exists (rows that cannot be run, a check that cannot be made).
  if (!keys.includes('draft_stage')) keys.push('mark_blocked');
  keys.push('request_user_decision');
  // Nor is open-ended work declared complete by Go at the end of a round: on
  // production, with the write-up no longer offered, it proposed "Objective
  // complete" instead of the next round (4 Oct). Ending it is the user's.
  if (!stage.transitions.loop_to) keys.push('declare_objective_complete');
  // A round's stages stay on their task (production, 5 Oct): offered the
  // reasoning moves, Go spent a whole window deriving and comparing on Next
  // question instead of writing it, so the next round was never proposed.
  // A stage still holding last round's draft is drafted, or the user asked;
  // the stage that closes a round chooses the question, it does not reason.
  if (staleRoundDraft) return keys.filter((k) => k === 'draft_stage' || k === 'request_user_decision');
  if (stage.transitions.loop_to) return keys.filter((k) => !REASONING_MOVES.has(k));
  return keys;
}

/** The inquiry moves (derive, compare, look up…): offered where a stage investigates. */
const REASONING_MOVES = new Set([
  'derive', 'prove', 'simplify', 'limiting_case', 'try_contradiction', 'run_computation',
  'falsify_hypothesis', 'compare_alternatives', 'update_assumptions', 'check_literature',
]);

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
  const pair = alternating(finished);
  if (pair) {
    const name = (k: string) => actionFor(k)?.label ?? STEP_WORDS[k] ?? k;
    return {
      status: 'blocked',
      reason: `"${name(pair[0])}" and "${name(pair[1])}" have been taking turns on this stage without it moving on. It needs your direction.`,
    };
  }
  if (noProgress(finished)) {
    const last = finished.at(-1)!;
    return {
      status: 'blocked',
      reason: `"${actionFor(last.action_key)?.label ?? last.action_key}" was chosen ${NO_PROGRESS_REPEATS} times in a row on this stage without changing it. It needs your direction.`,
    };
  }
  return null;
}

/** Performers whose step saves a new version when it succeeds. */
const SAVING = new Set(['draft', 'revise', 'continue', 'outline', 'apply', 'triage']);

/** The step saved something new to the project. */
function savedSomething(s: AgentStep): boolean {
  if (s.status !== 'succeeded' || !SAVING.has(actionFor(s.action_key)?.performer ?? '')) return false;
  const ids = (s.changes as { version_ids?: unknown } | null)?.version_ids;
  return Array.isArray(ids) && ids.length > 0;
}

/**
 * The same move three times on one stage with nothing to show for it.
 *
 * A repeated name alone is not a loop (Sean, 4 Oct): three "Revise this
 * stage" steps with different reasons that each saved a new version are
 * three revisions, and the polish cap bounds them. Three that saved nothing
 * — or three of a reasoning move, which never saves — are a run going round.
 */
export function noProgress(finished: readonly AgentStep[]): boolean {
  const tail = finished.slice(-NO_PROGRESS_REPEATS);
  if (
    tail.length >= NO_PROGRESS_REPEATS &&
    tail.every((s) => s.action_key === tail[0].action_key && s.stage_id === tail[0].stage_id) &&
    !tail.every(savedSomething)
  ) {
    return true;
  }
  return alternating(finished) !== null;
}

/** Two moves taking turns this many times over is a loop, not a second pass. */
export const ALTERNATING_ROUNDS = 3;

/**
 * Two moves taking turns on one stage — check, apply, check, apply, check,
 * apply — is the loop the client's execution log showed (2 Oct, screenshot 7:
 * "Check this stage", "Apply the findings", over and over, then "Mark this
 * stage stuck"). The same-move guard never saw it. Three rounds, not two: a
 * check followed by a revision and a second check is ordinary work. Returns
 * the pair, or null.
 */
export function alternating(finished: readonly AgentStep[]): [string, string] | null {
  const n = ALTERNATING_ROUNDS * 2;
  // A computation and its interpretation are one move in two steps; counted
  // apart they looked like two moves taking turns (production Research pass).
  const tail = finished.filter((s) => s.action_key !== INTERPRET_STEP).slice(-n);
  if (tail.length < n) return null;
  const [a, b] = tail;
  if (a.action_key === b.action_key || !tail.every((s) => s.stage_id === a.stage_id)) return null;
  const holds = tail.every((s, i) => s.action_key === (i % 2 === 0 ? a.action_key : b.action_key));
  return holds ? [a.action_key, b.action_key] : null;
}

/**
 * What the project is, in one string, so two reads can be compared (2 Oct,
 * screenshot 7). Pure. Changes when a stage moves, a version lands, an event
 * is recorded, a blocking requirement is met, a chapter is written, a row is
 * decided or the outline is approved — and not otherwise.
 */
export function stateFingerprint(input: {
  state: WorkflowState;
  bundles: Record<string, StageArtifactBundle>;
  events: readonly unknown[];
  facts: StageFacts;
  stageEvaluation: StageEvaluation;
}): string {
  const { state, bundles, events, facts, stageEvaluation } = input;
  const heads = Object.keys(bundles)
    .sort()
    .map((id) => `${id}=${bundles[id]?.versions.at(-1)?.id ?? ''}`)
    .join(',');
  const met = stageEvaluation.criteria.filter((c) => c.blocking && c.satisfied).map((c) => c.id).sort().join(',');
  return [
    state.current_stage_id,
    heads,
    `events:${events.length}`,
    `met:${met}`,
    `chapters:${facts.manuscript?.complete ?? ''}`,
    `decided:${facts.review ? facts.review.items.length - facts.review.routine.length - facts.review.material.length : ''}`,
    `outline:${facts.outline?.approved ?? ''}`,
  ].join('|');
}

/**
 * The last NO_CHANGE_STEPS performed moves left the project exactly as it
 * was: the stop, said as what the user can do about it. Null while the run
 * is changing something.
 */
export function noChange(fingerprints: readonly string[]): string | null {
  const tail = fingerprints.slice(-NO_CHANGE_STEPS);
  if (tail.length < NO_CHANGE_STEPS || !tail.every((f) => f === tail[0])) return null;
  return (
    `The last ${NO_CHANGE_STEPS} moves changed nothing on this stage — no new version, no decision recorded, ` +
    'no requirement met. Tell me what to do differently, or do the next part yourself and press Resume.'
  );
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
