'use client';

import { shownStepActionLabel } from '@/lib/i18n/go';
import { keepFound, webAccessOf } from '@/lib/workflow/web-found';
import { sourcesToCheck } from '@/lib/workflow/lookup';

/**
 * Go mode's loop, driven from the browser and persisted as it goes (B4,
 * PM-17, PM-18).
 *
 * Sean, Sep 10: read the state; choose the best expert next move; perform it;
 * update the state; choose again — until genuinely blocked or a meaningful
 * decision needs the user.
 *
 * What makes it safe to run from a tab:
 *
 * - **Every step is written before it runs** and closed after, so a refresh or
 *   a crash mid-step leaves a row saying so. On reopening, a step still
 *   `running` in a run nobody is heart-beating is marked `interrupted` and
 *   never replayed; the planner sees it in the history and chooses afresh.
 * - **Stop is immediate.** One AbortController per run; a response that lands
 *   after Stop is discarded, and the in-flight step is closed as `cancelled`.
 * - **One driver per run.** The run carries a lease (tab id + heartbeat every
 *   10s). A second tab that finds a fresh heartbeat shows the run read-only
 *   instead of driving it too.
 * - **The policy decides, not the model** (lib/agent/policy.ts): Guided pauses
 *   before every move, Checkpoint before important ones, Autonomous only when
 *   the model asks the user something. Budget, blocked stages, no progress and
 *   repeated failure are checked before any model call.
 *
 * Known limitation (docs/known-limitations.md): the loop runs while the tab is
 * open. Closing it pauses the run, and reopening the project resumes it.
 */

import { recordErrorEvent, runMeterCalls, setUsageOperation, startRunMeter, takeOutsideCost, takeStepCost } from '@/lib/supabase/model-usage';
import { asError, retryOnce } from '@/lib/supabase/errors';
import { RefusedRevision } from '@/lib/workflow/commit-check';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, type AnswerContradiction } from '@/lib/api/client';
import { ANSWER_OBJECTIVE_REASON, FIX_OBJECTIVE_REASON } from '@/lib/agent/objective-fixes';
import { deliverableDocument } from '@/lib/workflow/deliverable';
import { actionFor, actionLabel, AWAIT_SECTIONS_STEP, INTERPRET_STEP, ROUTINE_DEFAULT_STEP, SETTLED_STEP, USER_ANSWER_STEP, whatApprovalDoes } from '@/lib/agent/actions';
import { describeSettled, nothingSaid, settleItems, settleKey, settleMarks, userStatements, withMarks } from '@/lib/agent/settle';
import { answeredKept, queueLines, userQueue } from '@/lib/agent/user-queue';
import { keptQuestions } from '@/lib/agent/account';
import { contextWithFacts, readOutcomeProof, readStageFacts, type StageFacts } from '@/lib/agent/facts';
import { serializeItems, stageDrafts } from '@/lib/workflow/stage-artifact';
import { carryNewerFixes, describeCarried, fixesToMerge, reasksCarried, type NewerFixes } from '@/lib/agent/review-rounds';
import { approvedAsItStands, delegableToCommit, exhaustedRepair, policyConfirmable, repairStuckNeed, repairTries, staleRepair, unrepairableStale, describeNeed, NEED_CLEARED, NEED_MOVED_ON, needStillHolds, needsUser, openRowsElsewhere, requiredWork, waitingOnTable, type NeedsUser, REPAIR_TRIES } from '@/lib/agent/needs';
import { assertHonestOutcome, verifyOutcome } from '@/lib/agent/outcome';
import { outlineStageFor } from '@/lib/outline/actions';
import { effectiveRenderer } from '@/lib/workflow/stage-artifact';
import { listRecommendations, recordDecision } from '@/lib/supabase/recommendations';
import { projectMemory } from '@/lib/agent/memory';
import { requestProjectCancel } from '@/lib/supabase/jobs';
import { recordFacts } from '@/lib/supabase/facts';
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
import { answerAsFact, answerDocuments, measuredDocument, delegatedWhy, isDelegatedAnswer, settlesInTheText } from '@/lib/workflow/answers';
import { authorizeRun, DEFAULT_AUTO_WINDOWS } from '@/lib/agent/authorize';
import { buildAgentState } from '@/lib/agent/digest';
import { delegationSentences } from '@/lib/agent/delegation';
import { performStep, type PerformContext, type StepOutcome } from '@/lib/agent/perform';
import { needsExpert, packageMarkdown, recordDocuments } from '@/lib/agent/expert';
import { creditStop, isOutOfCredits } from '@/lib/agent/credit-stop';
import { findingAsQuestion, MAX_FINDINGS_SCREENED, planFromScreen, shouldScreen, type ScreenPlan } from '@/lib/agent/question-screen';
import { createTask } from '@/lib/supabase/tasks';
import { approvalStandsThroughRepairs } from '@/lib/workflow/approvals';
import { describeLengthTarget, wholeLengthTarget } from '@/lib/workflow/measurable';
import { latestObjectiveAssessment } from '@/lib/workflow/objective';
import { auditStop, describeAudit, proposedDefault, touchesObjective } from '@/lib/agent/stop-audit';
import { recordRoutineDefault } from '@/lib/supabase/facts';
import { MAX_RETURNS, allowedActions, unplannedMove, answeredReturn, returnsForAnswer, reconsiderNote, returnTargets, runAttemptsFor, stageHasCurrentDraft, toolsFor, polishSinceDirection, polishCapped, unsavedDerivation, saveInsteadOfRepeating, moveOnInsteadOfRejudging, withoutEndlessPolish, withoutSettledRuns, withoutOverride, DEFAULT_BUDGET_STEPS, MAX_MODEL_CALLS_PER_CHAIN, fitsBudget, noChange, plannedBeforeLatestChange, preempt, shouldPause, stateFingerprint, stepCost, levelFor } from '@/lib/agent/policy';
import {
  autoWindowsLeft,
  createAgentRun,
  endAgentRun,
  finishAgentStep,
  getLatestAgentRun,
  getLiveAgentRun,
  listAgentSteps,
  listChainSteps,
  setAgentStepStatus,
  startAgentStep,
  updateAgentRun,
} from '@/lib/supabase/agent';
import { dataFileBriefs, type StageArtifactBundle } from '@/lib/workflow/digest';
import type { StageFigures } from '@/lib/workflow/figures';
import type { StageControl } from '@/lib/workflow/stage-controls';
import { evaluateStage, getStage, nextSuggestedStage, outstandingWork } from '@/lib/workflow/engine';
import { objectiveUnmet } from '@/lib/workflow/objective';
import { addedByRun, mayAddStages, MAX_ADDED_PER_RUN } from '@/lib/workflow/added-stages';
import { isDone } from '@/lib/workflow/types';
import { documentsAwaitingFacts } from '@/lib/workflow/facts';
import { modeForStage } from '@/lib/workflow/stage-mode';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { StageContext, StageDefinition, StageEvaluation, WorkflowEvent, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import type { AgentRun, AgentRunStatus, AgentStep, ExecutionPolicy } from '@/types/agent';
import type { OutlineSection } from '@/types';
import type { Evaluation, Project } from '@/types/project';
import { repeatedQuestion, repeatPause } from '@/lib/agent/repeat-question';
import { drivingHere, onePress } from '@/lib/agent/one-press';

export const HEARTBEAT_MS = 10_000;
const WATCHING_ELSEWHERE = 'Go is running this project in another tab. It will carry on here if that tab closes; stop it there to start again here.';
/** A heartbeat older than this means the tab that held the lease is gone. */
export const LEASE_STALE_MS = 25_000;

export type GoPhase = 'idle' | 'thinking' | 'performing' | 'awaiting' | 'ended' | 'watching';

/** The database's "one running run per project" refused a second one (25 Oct, Sean's phone). */
export function isDuplicateRun(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === '23505' || /agent_runs_one_running_per_project/.test(err?.message ?? '');
}

/** A running run another tab holds and is still beating for: this tab watches it, never starts its own. */
export function drivenElsewhere(run: Pick<AgentRun, 'status' | 'heartbeat_at' | 'lease_holder'> | null, tabId: string, now = Date.now()): boolean {
  if (!run || run.status !== 'running' || !run.lease_holder || run.lease_holder === tabId) return false;
  return !!run.heartbeat_at && now - new Date(run.heartbeat_at).getTime() < LEASE_STALE_MS;
}

/**
 * The step did its work, but its own record could not be saved, twice. The
 * work is in the project (a stage move is an event, a draft a version), so the
 * step must not be closed as if it had failed (client, 21 Oct: "Move to the
 * next stage — Failed" on a move that was recorded).
 */
class StepNotRecorded extends Error {
  constructor(readonly outcome: StepOutcome, cause: unknown) {
    super(asError(cause, 'the record could not be saved').message);
  }
}

interface Options {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition | undefined;
  /** Rows chosen in the table on screen and not saved yet: Resume saves them before it carries on. */
  unsavedRows?: { stageId: string; save: () => Promise<void> } | null;
  bundles: Record<string, StageArtifactBundle>;
  context: StageContext;
  stageEvaluation: StageEvaluation;
  latestEvaluation?: Evaluation | null;
  approvedOutline: OutlineSection[];
  deliverableDone: boolean;
  enabled: boolean;
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
  recordStageEvaluation?: (stageId: string, versionId: string, evaluation: NewEvaluation) => Promise<Evaluation>;
  setStageSummary?: (stageId: string, summary: string) => Promise<void>;
  setStageFigures?: (stageId: string, figures: StageFigures) => Promise<void>;
  /** Re-read the event log after a stage event; resolves once the page has it. */
  reloadEvents: () => Promise<void>;
  /** Tick an approval committed under the routine-decision policy, saved before it resolves. */
  commitCriterion?: (stageId: string, criterionId: string, versionId?: string) => Promise<void>;
  /** Untick approvals (Q2e): the reserved ones of a stage Go goes back to. */
  reopenApprovals?: (criterionIds: string[]) => Promise<void>;
  /** The event log, for the facts a stage's own controls need (approvals). */
  events: readonly WorkflowEvent[];
  /**
   * Read the events fresh from the database for each move. The prop above
   * lags a render right after a card's own button (approve the outline,
   * confirm a box), and the first move then reasoned from the old log.
   */
  loadEvents?: () => Promise<readonly WorkflowEvent[]>;
  /** Re-read the project after a write the store did not make itself. */
  onRefresh?: () => unknown;
  /** The buttons on the current stage's page now; null while another stage is on show. */
  getControls?: () => StageControl[] | null;
}

class Stopped extends Error {}

/**
 * The project's current stage is not in its workflow. Was a silent `Stopped`:
 * the loop returned with the run still "running", the phase stuck on
 * performing and the heartbeat going, and nothing on screen said why (4 Oct).
 * As an ordinary error it is recorded on the run and shown.
 */
const NO_STAGE = "Go stopped: this project's current stage isn't part of its workflow. Reload the page, then start Go again.";

/** The project's decisions for the planner, read fresh. Never throws: no memory is not a reason to stop. */
async function readMemory(o: Options, steps: readonly AgentStep[]): Promise<string[]> {
  try {
    const [events, recommendations] = await Promise.all([
      o.loadEvents ? o.loadEvents() : Promise.resolve(o.events),
      listRecommendations(o.project.id),
    ]);
    return projectMemory({ template: o.template, events, recommendations, steps });
  } catch {
    return [];
  }
}

/**
 * The user's answer to the last "which takes priority?" this run asked on
 * this stage, if nothing has been revised since. One answer lets one
 * revision through; the next revision is checked afresh.
 */
function answerToConflict(steps: readonly AgentStep[], stageId: string): string | undefined {
  const asked = steps.map((s) => s.stage_id === stageId && s.params?.conflict_question === true).lastIndexOf(true);
  if (asked < 0) return undefined;
  const after = steps.slice(asked + 1);
  // The user's answer, or the default Go took under "handle them for me".
  const answer = after.findIndex((s) => s.action_key === USER_ANSWER_STEP || (s.action_key === ROUTINE_DEFAULT_STEP && typeof s.params?.conflict_answer === 'string'));
  if (answer < 0) return undefined;
  const revisedSince = after.slice(answer + 1).some(
    (s) => ['revise', 'apply'].includes(actionFor(s.action_key)?.performer ?? '') && s.status === 'succeeded'
  );
  const given = after[answer];
  const text = given.action_key === ROUTINE_DEFAULT_STEP ? String(given.params?.conflict_answer) : given.output;
  return revisedSince ? undefined : text.trim() || undefined;
}

/** Whether the answer `answerToConflict` found is the default Go took itself. */
function conflictAnswerIsRoutine(steps: readonly AgentStep[], stageId: string): boolean {
  const asked = steps.map((s) => s.stage_id === stageId && s.params?.conflict_question === true).lastIndexOf(true);
  if (asked < 0) return false;
  return steps.slice(asked + 1).find((s) => s.action_key === USER_ANSWER_STEP || (s.action_key === ROUTINE_DEFAULT_STEP && typeof s.params?.conflict_answer === 'string'))?.action_key === ROUTINE_DEFAULT_STEP;
}

/**
 * Under autonomous + "handle them for me", a guard question that carries its
 * own record-keeping answer is not put to the user: Go takes that answer once
 * per stage per window and tries again (25 Oct, Sean: the run stopped on "give
 * O1 to a different item?" and five stages waited behind it).
 */
export function routineConflictAnswer(input: {
  outcome: Pick<StepOutcome, 'params' | 'stop'>;
  policy: ExecutionPolicy;
  routine: string | null | undefined;
  stageId: string;
  steps: readonly AgentStep[];
}): string | null {
  const answer = input.outcome.params?.routine_answer;
  if (typeof answer !== 'string' || !answer || !input.outcome.stop) return null;
  if (input.policy !== 'autonomous' || input.routine !== 'handle') return null;
  const already = input.steps.some((s) => s.stage_id === input.stageId && s.action_key === ROUTINE_DEFAULT_STEP && typeof s.params?.conflict_answer === 'string');
  return already ? null : answer;
}

/**
 * A guard's refusal that has already had its one routine answer: set aside
 * rather than put to the user. The revision stays unsaved and the current
 * version stands.
 */
export function refusalSetAside(
  outcome: StepOutcome,
  input: { policy: ExecutionPolicy; routine: string | null | undefined; stageId: string; steps: readonly AgentStep[] }
): StepOutcome {
  if (outcome.status !== 'blocked' || typeof outcome.params?.routine_answer !== 'string') return outcome;
  if (input.policy !== 'autonomous' || input.routine !== 'handle') return outcome;
  if (routineConflictAnswer({ outcome, ...input })) return outcome;
  const reason = outcome.output.replace(/ Should those items come back[\s\S]*$/, '');
  return { ...outcome, status: 'failed', blockKind: null, stop: undefined, needs: undefined, params: {}, output: reason, setAside: reason };
}

/**
 * Under "handle them for me", an objective check that names what is unmet on a
 * written document doesn't stop for a button: Go repairs it, up to the repair
 * limit, and the check runs again. Past the limit the card is shown as before.
 */
export function unmetIsRoutine(
  outcome: StepOutcome,
  input: { policy: ExecutionPolicy; routine: string | null | undefined; template: Pick<WorkflowTemplate, 'stages'>; tried: readonly string[] }
): StepOutcome {
  const need = outcome.needs;
  if (need?.kind !== 'objective_check' || need.finding !== 'unmet') return outcome;
  if (input.policy !== 'autonomous' || input.routine !== 'handle') return outcome;
  if (input.template.stages.find((s) => s.id === need.stageId)?.renderer !== 'prose') return outcome;
  if (input.tried.filter((id) => id === need.stageId).length >= REPAIR_TRIES) return outcome;
  return { ...outcome, stop: undefined, needs: undefined };
}

/**
 * This tab's lease identity. Kept in sessionStorage, which is per tab and
 * survives a reload — so reloading resumes the run this tab was driving,
 * while a second tab gets its own id and watches instead.
 */
function tabIdentity(): string {
  const fresh = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
  try {
    const kept = sessionStorage.getItem('pm-go-tab');
    if (kept) return kept;
    sessionStorage.setItem('pm-go-tab', fresh);
  } catch {
    // Private mode or blocked storage: a reload then looks like a new tab,
    // which only means waiting out one stale heartbeat before resuming.
  }
  return fresh;
}

/** Let React render what the last await changed before reading props again. */
const settle = () => new Promise((r) => setTimeout(r, 60));

/** The planner's calls, tagged as Go's so the usage views count them (4 Nov). */
async function planning<T>(call: () => Promise<T>): Promise<T> {
  setUsageOperation({ operation: 'go:plan' });
  try {
    return await call();
  } finally {
    setUsageOperation(null);
  }
}

/** The stages this run saved a version on, by name, for the pause that says what was saved (4 Nov). */
export function savedStages(steps: readonly AgentStep[], stageLabel: (id: string) => string): string[] {
  const out: string[] = [];
  for (const s of steps) {
    const ids = (s.changes as { version_ids?: unknown } | null)?.version_ids;
    if (!Array.isArray(ids) || !ids.length) continue;
    const target = (s.params as { stage_id?: unknown } | null)?.stage_id;
    const label = stageLabel(typeof target === 'string' && target ? target : s.stage_id);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

export function useGoLoop(opts: Options) {
  const [policy, setPolicy] = useState<ExecutionPolicy>('guided');
  const [budget, setBudget] = useState(DEFAULT_BUDGET_STEPS);
  /**
   * Further windows an Autonomous run may start on its own. Three by default
   * (17 Oct, Sean: "Should we automatically have it on maximum steps and
   * windows if that is necessary?") — a run still stops whenever it needs the
   * user, so the windows only spare a click between them.
   */
  const [autoWindows, setAutoWindows] = useState(DEFAULT_AUTO_WINDOWS);
  const autoLeftRef = useRef(0);
  // Whether a used-up window will be followed by another without asking.
  // State, not the ref, so the "window used up" card is not shown for the
  // moment between one window ending and the next starting.
  const [autoPending, setAutoPending] = useState(false);
  const continueRef = useRef<(auto?: boolean) => Promise<void>>(async () => {});
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [phase, setPhase] = useState<GoPhase>('idle');
  const phaseRef = useRef<GoPhase>('idle');
  phaseRef.current = phase;
  /** `adopt`, reachable from the controls declared above it. */
  const adoptRef = useRef<(found: AgentRun) => Promise<void>>(async () => {});
  const [pendingStepId, setPendingStepId] = useState<string | null>(null);
  /** The policy being authorized and started this moment (one click; no dialog any more). */
  const [authorizing, setAuthorizing] = useState<Exclude<ExecutionPolicy, 'guided'> | null>(null);
  const startingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(opts);
  latest.current = opts;
  const runRef = useRef<AgentRun | null>(null);
  const stepsRef = useRef<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // One press at a time (12 Nov): an answer pressed twice started a second loop on
  // the same run, which closed the first loop's step and ended the run failed.
  const pressRef = useRef(onePress());
  const goingRef = useRef(false);
  // What the settle check was last asked: the same rows and words are not asked about twice.
  const settleAskedRef = useRef('');
  const followRef = useRef<StepOutcome['followUp'] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  // The call ceiling (4 Nov): set when a run paused at it, so no window starts on its own past it.
  const callCapRef = useRef(false);
  // Model calls this allowance has made, refreshed as the run moves.
  const [calls, setCalls] = useState<number | null>(null);
  /** A user's Go, Resume or Continue: a fresh allowance of model calls. */
  const freshAllowance = useCallback(() => {
    callCapRef.current = false;
    startRunMeter(0);
    setCalls(0);
  }, []);
  /** Steps of the windows this run continues (B4): the planner reads them as history. */
  const priorStepsRef = useRef<AgentStep[]>([]);
  // The same steps for the page: a question set aside in an earlier window is still waiting on the
  // user in this one, and the list of what waits read this window alone (12 Nov, production pass).
  const [priorSteps, setPriorSteps] = useState<AgentStep[]>([]);
  const setPrior = useCallback((earlier: AgentStep[]) => {
    priorStepsRef.current = earlier;
    setPriorSteps(earlier);
  }, []);
  /** The user said "draft them anyway" for this many sections (FR-18). */
  const largeJobOkRef = useRef<number | null>(null);
  /**
   * Steps before this index predate the last Go/Resume. The no-progress and
   * repeated-failure guards only count what happened since: pressing Resume
   * after "chosen 3 times without moving on" is the user's direction to carry
   * on, and re-reading the same three steps made it an instant dead end.
   */
  const sinceRef = useRef(0);
  /** Major findings already read this session: a verdict is not paid for twice. */
  const screenedFindingsRef = useRef(new Map<string, boolean>());
  /**
   * What the project was after each performed move since the last Go/Resume
   * (`stateFingerprint`). Three in a row the same is a run going round in
   * circles (2 Oct, screenshot 7), whatever the moves were called.
   */
  const fingerprintsRef = useRef<string[]>([]);
  /** Q2b: the window has reconsidered once after going round in circles; `pending` moves are withdrawn for the next choice. */
  const reconsiderRef = useRef<{ withdrawn: string[]; note: string; pending?: boolean } | null>(null);
  /** Stages the user asked Go to try once more ("Try once more"): one more repair each, beyond `REPAIR_TRIES`. */
  const extraTriesRef = useRef<Map<string, number>>(new Map());
  /** What the user said to fix, per stage, for the next repair of it. */
  const repairNotesRef = useRef(new Map<string, string>());
  /** A move that counted against the window was performed since the last read. */
  const performedRef = useRef(false);
  const tabId = useRef<string>('');
  if (!tabId.current && typeof window !== 'undefined') tabId.current = tabIdentity();

  const commitRun = useCallback((next: AgentRun | null) => {
    runRef.current = next;
    setRun(next);
  }, []);
  const commitSteps = useCallback((next: AgentStep[]) => {
    stepsRef.current = next;
    setSteps(next);
  }, []);
  const upsertStep = useCallback(
    (step: AgentStep) => {
      const list = stepsRef.current.filter((s) => s.id !== step.id);
      commitSteps([...list, step].sort((a, b) => a.idx - b.idx));
    },
    [commitSteps]
  );

  const setRunStatus = useCallback(
    async (status: AgentRunStatus, reason: string | null, needs: NeedsUser | null = null) => {
      const current = runRef.current;
      if (!current) return;
      // Where the project was when the run asked: a request is only shown,
      // and only re-checked, against that stage.
      if (needs) needs = { ...needs, onStage: latest.current.state.current_stage_id, raisedAt: new Date().toISOString() };
      const terminal = ['completed', 'budget_exhausted', 'stopped', 'failed'].includes(status);
      if (terminal) await endAgentRun(current.id, status, reason ?? '', needs);
      else await updateAgentRun(current.id, { status, stop_reason: reason, needs });
      commitRun({ ...current, status, stop_reason: reason, needs, ended_at: terminal ? new Date().toISOString() : null });
    },
    [commitRun]
  );
  const stageLabelFor = useCallback((id: string) => getStage(latest.current.template, id)?.short_label ?? id, []);
  // A step's name and what approving it does, on its own stage (10 Oct, email 6.3).
  const stepLabel = useCallback(
    // Shown on the page only: in the interface's language (client, 21 Oct).
    (s: Pick<AgentStep, 'action_key' | 'stage_id'>) => shownStepActionLabel(s.action_key, s.stage_id ? getStage(latest.current.template, s.stage_id) : null),
    []
  );
  const stepEffect = useCallback((s: Pick<AgentStep, 'action_key' | 'stage_id'>) => {
    const stage = s.stage_id ? getStage(latest.current.template, s.stage_id) : null;
    const next = stage?.transitions.default_next ? getStage(latest.current.template, stage.transitions.default_next)?.label ?? null : null;
    return whatApprovalDoes(s.action_key, stage, next);
  }, []);

  // --- performing one step ------------------------------------------------------

  const perform = useCallback(
    async (step: AgentStep, approvedByUser: boolean, signal: AbortSignal): Promise<'continue' | 'stop'> => {
      const o = latest.current;
      const current = runRef.current!;
      if (!o.stage) throw new Error(NO_STAGE);
      setPhase('performing');

      const interpret = step.action_key === INTERPRET_STEP ? followRef.current ?? undefined : undefined;
      followRef.current = null;
      // Fresh, not from props: a step approved after a pause must act on the
      // stage as it is now (B1).
      const facts = await readStageFacts({
        project: o.project, template: o.template, stage: o.stage, bundles: o.bundles,
        events: o.loadEvents ? await o.loadEvents() : o.events, latestEvaluation: o.latestEvaluation,
      });
      setProgress(null);
      const memory = await readMemory(o, [...priorStepsRef.current, ...stepsRef.current]);
      // The requirements, judged against the same read (1 Oct, item 1).
      const context = contextWithFacts(o.context, o.stage, facts);

      const ctx: PerformContext = {
        project: o.project, template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
        context, approvedOutline: o.approvedOutline, run: current, step,
        digest: buildAgentState({
          template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
          stageEvaluation: evaluateStage(o.template, o.stage.id, context), latestEvaluation: o.latestEvaluation,
          steps: [...priorStepsRef.current, ...stepsRef.current],
          context, approvedOutline: o.approvedOutline, facts, dataFiles: dataFileBriefs(o.project), tools: toolsFor(o.project), routine: o.project.routine_decisions ?? undefined, delegation: delegationSentences(o.project), memory, controls: o.getControls?.() ?? undefined,
        }),
        approvedByUser, deliverableDone: o.deliverableDone,
        interpret: interpret
          ? { sandboxRunId: interpret.sandboxRunId, code: interpret.code, stdout: interpret.stdout, stderr: interpret.stderr, exitCode: interpret.exitCode }
          : undefined,
        appendStageVersion: o.appendStageVersion, recordStageEvaluation: o.recordStageEvaluation,
        setStageSummary: o.setStageSummary, setStageFigures: o.setStageFigures, afterStageEvent: o.reloadEvents,
        loadEvents: async () => (o.loadEvents ? o.loadEvents() : latest.current.events), commitCriterion: o.commitCriterion, reopenApprovals: o.reopenApprovals, signal,
        facts, latestEvaluation: o.latestEvaluation, refresh: o.onRefresh, onProgress: setProgress,
        conflictAnswer: answerToConflict(stepsRef.current, o.stage.id),
        conflictAnswerRoutine: conflictAnswerIsRoutine(stepsRef.current, o.stage.id),
        derived: unsavedDerivation([...priorStepsRef.current, ...stepsRef.current], o.stage.id) ?? undefined,
      };

      let outcome: StepOutcome;
      // Every model call this move makes is attributed to it (E1).
      setUsageOperation({ operation: `go:${step.action_key}`, agentStepId: step.id });
      try {
        // "Succeeded" means the project changed (SN-25).
        outcome = assertHonestOutcome(step.action_key, await performStep(ctx));
      } catch (e) {
        if (signal.aborted || (e as Error)?.name === 'AbortError') throw new Stopped();
        outcome = isOutOfCredits(e) ? creditStop((e as Error).message) : {
          status: 'failed', label: null, toolsUsed: [], changes: {},
          // A refused revision tells the next plan what a retry must do; a
          // second failure in a row stops the run (MAX_CONSECUTIVE_FAILURES).
          output: e instanceof RefusedRevision
            ? `${e.message}. A retry must start from the current version and keep every row the user decided.`
            : asError(e, 'The step failed.').message,
        };
      }
      if (signal.aborted) throw new Stopped();
      // Under "handle them for me" a guard's refusal is never a question: its
      // answer was already taken once. Nothing is saved, the IDs are named in
      // the run's account, and it doesn't count toward the two-failure stop (8 Nov).
      outcome = refusalSetAside(outcome, { policy: current.policy, routine: o.project.routine_decisions, stageId: o.stage.id, steps: stepsRef.current });
      // …and what the final check found unmet is a routine repair: the next move makes it (8 Nov).
      outcome = unmetIsRoutine(outcome, {
        policy: current.policy, routine: o.project.routine_decisions, template: o.template,
        tried: repairTries([...priorStepsRef.current, ...stepsRef.current], o.state, new Set(stepsRef.current.map((s) => s.id))),
      });

      // ...and that the change is in the project, read back rather than
      // reported (1 Oct, item 4).
      if (outcome.status === 'succeeded') {
        const stage = o.stage;
        const claimed = outcome;
        outcome = await readOutcomeProof({
          actionKey: step.action_key, outcome: claimed, template: o.template, stage, facts,
          loadEvents: async () => (o.loadEvents ? o.loadEvents() : latest.current.events),
        }).then(
          (proof) => verifyOutcome(step.action_key, claimed, proof),
          // Unable to read is not the same as not there: say so, do not guess.
          () => ({ ...claimed, output: `${claimed.output}\n\nNot confirmed: the project could not be read back after this step.` })
        );
        if (signal.aborted) throw new Stopped();
      }

      setUsageOperation(null);
      const costUsd = takeStepCost(step.id);
      const done = outcome;
      // A phone that drops its connection for a moment must not turn a move
      // that happened into a failed one: try the record twice.
      const finished = await retryOnce(() => finishAgentStep(step.id, {
        status: done.status, label: done.label, output: done.output, blockKind: done.blockKind ?? null,
        toolsUsed: done.toolsUsed, changes: done.setAside ? { ...done.changes, set_aside: done.setAside } : done.changes, params: done.params,
        costUsd,
      })).catch((e) => {
        throw new StepNotRecorded(done, e);
      });
      upsertStep(finished);
      setProgress(null);
      // The run's cost is the sum of its steps' (31 Oct: shown in the Go
      // panel). Best-effort: a missed total costs the line, not the step.
      setCalls(runMeterCalls());
      // …and what Go spent choosing its moves, which no step carries (4 Nov).
      const outside = takeOutsideCost().cost;
      const added = (costUsd ?? 0) + outside;
      if (added > 0 && runRef.current) {
        const total = Number(runRef.current.cost_usd ?? 0) + added;
        commitRun({ ...runRef.current, cost_usd: total });
        void updateAgentRun(current.id, { cost_usd: total }).catch(() => undefined);
      }
      // Waiting for sections already queued is not a move; it costs no step.
      // …and neither is a stop that only repeated one already made (2 Oct, item 9).
      if (step.action_key !== AWAIT_SECTIONS_STEP && !outcome.free) {
        const used = (runRef.current?.steps_used ?? 0) + 1;
        await updateAgentRun(current.id, { steps_used: used, heartbeat_at: new Date().toISOString() });
        commitRun({ ...runRef.current!, steps_used: used });
        // A reasoning move (derive, prove, …) is work that lives in the step
        // itself and changes nothing on the stage by design; only the moves
        // that are supposed to change the project are judged by whether they did.
        if (actionFor(step.action_key)?.performer !== 'reason') performedRef.current = true;
      }

      if (outcome.followUp) followRef.current = outcome.followUp;
      if (outcome.status === 'interrupted') {
        // The work goes on in the background; the run waits for the user to
        // say "keep waiting" rather than spinning here.
        await setRunStatus(outcome.stop?.status ?? 'awaiting_decision', outcome.stop?.reason ?? outcome.output.split('\n')[0], outcome.needs ?? null);
        return 'stop';
      }
      const taken = routineConflictAnswer({
        outcome, policy: current.policy, routine: o.project.routine_decisions, stageId: o.stage.id, steps: stepsRef.current,
      });
      if (taken) {
        const question = outcome.stop?.reason ?? '';
        const step = await startAgentStep({
          runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
          stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: ROUTINE_DEFAULT_STEP,
          params: { question: question.slice(0, 1000), conflict_answer: taken },
          rationale: 'Routine decisions are mine to handle: taking the answer the question itself gives, and trying again.',
          expectedOutcome: 'The revision saved with the item IDs kept as they were.', needsDecision: false, decisionQuestion: null,
        });
        upsertStep(await finishAgentStep(step.id, {
          status: 'succeeded', label: null,
          output: `Answered for you under your routine-decision policy: ${taken} The revision is tried again with that rule.`,
        }));
        await settle();
        return 'continue';
      }
      if (outcome.stop) {
        await setRunStatus(outcome.stop.status, outcome.stop.reason, outcome.needs ?? null);
        return 'stop';
      }
      // A blocker recorded on its own item sets that item aside; the run goes
      // on with whatever else can proceed, and stops only when nothing can (Q1b).
      if (outcome.status === 'blocked' && !outcome.setAside) {
        await setRunStatus('blocked', outcome.output.split('\n')[0]);
        return 'stop';
      }
      await settle();
      return 'continue';
    },
    [upsertStep, commitRun, setRunStatus]
  );

  // --- the loop -----------------------------------------------------------------

  const loop = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setError(null);
    /**
     * Whether a question or a block needs the user at all (8 Nov). A real-world
     * action is recorded here, so the caller only has a repair to carry out or a
     * question to ask.
     */
    const screenStop = async (o: Options, stage: StageDefinition, question: string, allowed: readonly string[], expert: boolean): Promise<ScreenPlan> => {
      const current = runRef.current!;
      const routine = o.project.routine_decisions ?? 'ask';
      const steps = [...priorStepsRef.current, ...stepsRef.current];
      const recordedHere = stepsRef.current.filter((s) => s.stage_id === stage.id && s.action_key === ROUTINE_DEFAULT_STEP && s.params?.real_world === true).length;
      if (!shouldScreen({ policy: current.policy, routine, question, recordedHere, expert })) return { kind: 'ask' };
      const at = o.template.stages.findIndex((s) => s.id === stage.id);
      const screen = await api.agentScreenQuestion({
        inputs: inputsFrom(o.project), question, stage_label: stage.label,
        earlier_stages: o.template.stages.slice(0, Math.max(at, 0)).map((s) => s.label),
        reserved_approvals: stage.exit_criteria.filter((c) => c.check === 'manual' && c.authority !== 'delegable').map((c) => c.label),
        delegation: delegationSentences(o.project), model: o.project.model,
      }, signal).catch(() => null);
      if (signal.aborted) throw new Stopped();
      if (!screen) return { kind: 'ask' };
      const made = steps.filter((s) => s.action_key === 'return_to_stage' && s.status === 'succeeded').length;
      const plan = planFromScreen(screen, {
        question, template: o.template, stage, allowed, returnsLeft: MAX_RETURNS - made,
        approvalStands: approvalStandsThroughRepairs(o.project, stage, o.bundles[stage.id]?.versions ?? []),
      });
      if (plan.kind !== 'record') return plan;
      const step = await startAgentStep({
        runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
        stageId: stage.id, mode: modeForStage(o.project, stage), actionKey: ROUTINE_DEFAULT_STEP,
        params: { question: question.slice(0, 1000), real_world: true },
        rationale: `Instead of asking "${question.slice(0, 200)}": ${plan.reason || 'this is something to do outside the document.'}`,
        expectedOutcome: 'Recorded as still to do, and the document carries on.', needsDecision: false, decisionQuestion: null,
      });
      upsertStep(step);
      let output = `Recorded as still to do in the real world: ${plan.action}`;
      try {
        await createTask(o.project.id, o.project.user_id, { title: plan.action.slice(0, 240), detail: question.slice(0, 1000), stage: stage.id, origin: 'system' });
      } catch (e) {
        output = `Could not record it (${(e as Error).message}), so it is asked instead.`;
      }
      upsertStep(await finishAgentStep(step.id, { status: output.startsWith('Could not') ? 'failed' : 'succeeded', label: null, output }));
      return output.startsWith('Could not') ? { kind: 'ask' } : plan;
    };
    try {
      for (;;) {
        if (signal.aborted) throw new Stopped();
        let o = latest.current;
        // A stage just added is entered before the page has drawn it: wait for
        // the page to catch up rather than call the stage missing (25 Oct).
        for (let i = 0; !o.stage && i < 30 && !signal.aborted; i += 1) {
          await new Promise((r) => setTimeout(r, 100));
          o = latest.current;
        }
        const current = runRef.current!;
        if (!o.stage) throw new Error(NO_STAGE);

        // The second half of run_computation is not a choice: interpret what ran.
        if (followRef.current) {
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: INTERPRET_STEP,
            params: { sandbox_run_id: followRef.current.sandboxRunId },
            rationale: 'Code ran; reading what it actually printed.', expectedOutcome: 'What the output shows.',
            needsDecision: false, decisionQuestion: null,
          });
          upsertStep(step);
          if ((await perform(step, false, signal)) === 'stop') break;
          continue;
        }

        // The call ceiling (4 Nov): counted whatever the price, across the
        // windows Go started on its own; only the user's click starts afresh.
        const callsSoFar = runMeterCalls();
        if (callsSoFar !== null && callsSoFar >= MAX_MODEL_CALLS_PER_CHAIN) {
          callCapRef.current = true;
          const need: NeedsUser = { kind: 'continue_budget', budgetSteps: current.budget_steps, callCap: MAX_MODEL_CALLS_PER_CHAIN, saved: savedStages([...priorStepsRef.current, ...stepsRef.current], stageLabelFor) };
          await setRunStatus('budget_exhausted', `Paused after ${callsSoFar} model calls, the most one run makes without your click.`, need);
          break;
        }
        const stop = preempt({
          state: o.state, objective: o.project.objective, stepsUsed: current.steps_used,
          budgetSteps: current.budget_steps,
          steps: stepsRef.current.slice(sinceRef.current).filter((s) => s.action_key !== AWAIT_SECTIONS_STEP),
        });
        // Q2b: going round in circles is reconsidered once per window — the
        // repeated moves are withdrawn and the planner is told why — before
        // it stops for the user.
        if (stop?.repeating && !reconsiderRef.current) {
          reconsiderRef.current = { withdrawn: stop.repeating, note: reconsiderNote(stop.repeating), pending: true };
          sinceRef.current = stepsRef.current.length;
          fingerprintsRef.current = [];
          continue;
        }
        if (stop) {
          // Said as what the user can do about it (B4), not only why it stopped.
          const blocked = o.state.stages[o.stage.id]?.blocked;
          // A loop of repairs is said as what is unresolved and why, with
          // ways on (13 Oct, Sean: not "give it different direction").
          const lastRepair = stop.repeating?.includes('recheck_stage')
            ? [...stepsRef.current].reverse().find((s) => s.action_key === 'recheck_stage')
            : undefined;
          const repairTarget = stop.repairsFailedOn ?? (lastRepair ? String(lastRepair.params?.stage_id ?? lastRepair.stage_id) : '');
          const need: NeedsUser | null =
            repairTarget ? repairStuckNeed(o.state, repairTarget, [...priorStepsRef.current, ...stepsRef.current])
            : stop.status === 'budget_exhausted' ? { kind: 'continue_budget', budgetSteps: current.budget_steps, saved: savedStages([...priorStepsRef.current, ...stepsRef.current], stageLabelFor) }
            : stop.status === 'blocked' && blocked ? { kind: 'unblock_stage', stageId: o.stage.id, reason: blocked.reason, blockKind: blocked.kind }
            : stop.status === 'awaiting_decision' && !o.project.objective.trim() ? { kind: 'set_objective' }
            : null;
          await setRunStatus(stop.status, need?.kind === 'repair_stuck' ? describeNeed(need, stageLabelFor).message : stop.reason, need);
          break;
        }

        setPhase('thinking');
        const freshEvents = o.loadEvents ? await o.loadEvents() : o.events;
        const facts: StageFacts = await readStageFacts({
          project: o.project, template: o.template, stage: o.stage, bundles: o.bundles,
          events: freshEvents, latestEvaluation: o.latestEvaluation,
        });
        if (signal.aborted) throw new Stopped();
        // A "major" finding is often a routine correction, and major alone sent it
        // to the user (8 Nov, production: "length is not verified" stopped a run).
        // Read once each; anything not clearly routine stays theirs.
        if (facts.review?.material.length && current.policy === 'autonomous' && o.project.routine_decisions === 'handle' && !facts.review.outcome) {
          const moved: typeof facts.review.material = [];
          for (const row of facts.review.material.slice(0, MAX_FINDINGS_SCREENED)) {
            const key = `${o.stage.id}:${row.id}`;
            let routineRow = screenedFindingsRef.current.get(key);
            if (routineRow === undefined) {
              const screen = await api.agentScreenQuestion({
                inputs: inputsFrom(o.project), question: findingAsQuestion(row), stage_label: o.stage.label, earlier_stages: [], reserved_approvals: [],
                delegation: delegationSentences(o.project), model: o.project.model,
              }, signal).catch(() => null);
              if (signal.aborted) throw new Stopped();
              routineRow = screen?.verdict === 'routine_repair';
              screenedFindingsRef.current.set(key, routineRow);
            }
            if (routineRow) moved.push(row);
          }
          if (moved.length) {
            facts.review.routine = [...facts.review.routine, ...moved];
            facts.review.material = facts.review.material.filter((r) => !moved.includes(r));
          }
        }
        // What the project has already decided, from its own records (1 Oct, item 20).
        const memory = await readMemory(o, [...priorStepsRef.current, ...stepsRef.current]);

        // Sections already being written — after a reload, or started by the
        // user — are waited for first, without a planner call or a step.
        if (facts.manuscript?.pendingJobs.length) {
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: AWAIT_SECTIONS_STEP, params: {},
            rationale: `${facts.manuscript.pendingJobs.length} section(s) are being written; waiting for them.`,
            expectedOutcome: 'The sections land in the manuscript.', needsDecision: false, decisionQuestion: null,
          });
          upsertStep(step);
          if ((await perform(step, false, signal)) === 'stop') break;
          continue;
        }

        const hasDraft = stageHasCurrentDraft(o.template, o.state, o.stage.id, o.bundles[o.stage.id]?.versions.at(-1));
        // One read decides the moves, the requirements and what the planner
        // is told (1 Oct, item 1).
        const context = contextWithFacts(o.context, o.stage, facts);
        const stageEvaluation = evaluateStage(o.template, o.stage.id, context);

        // 12 Nov: a row carried forward as unmet that the user has since
        // answered — in the note on the row, or as a fact or decision — is
        // marked settled before a repair is forced for it or the run stops on
        // it. On the training plan the note read "There are no additional
        // absences to account for" and Go repaired the deliverable twice, then
        // stopped on the row. With routine decisions handed to Go; under "Ask
        // me" the stop offers it instead.
        const openRowsToRead = o.project.routine_decisions === 'handle' && o.appendStageVersion ? settleItems(o.template, context.carriedRows) : [];
        // …and so is a question Go set aside earlier that a later answer has
        // since covered: it is not asked again at the end.
        const allStepsNow = [...priorStepsRef.current, ...stepsRef.current];
        const keptToRead = o.project.routine_decisions === 'handle'
          ? keptQuestions(allStepsNow, answeredKept(o.project.facts, allStepsNow)).slice(0, 4).map((k) => ({ id: `kept::${k.stepId}`, stage: stageLabelFor(k.stageId), text: k.question, note: '' }))
          : [];
        if (openRowsToRead.length || keptToRead.length) {
          const { statements, factOf } = userStatements(o.project.facts);
          const toRead = [...openRowsToRead, ...keptToRead];
          const asked = settleKey(toRead, statements);
          if (asked !== settleAskedRef.current && !nothingSaid(toRead, statements)) {
            settleAskedRef.current = asked;
            const verdict = await api.agentSettles({ inputs: inputsFrom(o.project), items: toRead, statements, model: o.project.model }, signal).catch(() => null);
            if (signal.aborted) throw new Stopped();
            const marks = settleMarks(verdict?.settled, openRowsToRead, factOf);
            const keptSettled = (verdict?.settled ?? [])
              .filter((v) => v.id.startsWith('kept::') && factOf.has(v.by) && keptToRead.some((k) => k.id === v.id))
              .map((v) => ({ stepId: v.id.slice('kept::'.length), quote: v.quote, question: keptToRead.find((k) => k.id === v.id)?.text ?? '' }));
            if (marks.length || keptSettled.length) {
              const step = await startAgentStep({
                runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
                stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: SETTLED_STEP,
                params: {
                  settled: marks.map((m) => ({ stage_id: m.stageId, row_id: m.rowId, source: m.source })),
                  ...(keptSettled.length ? { kept_settled: keptSettled.map((k) => k.stepId) } : {}),
                },
                rationale: 'Something still counted as open was answered in your own words, so it is read against them before anything is repaired or asked again.',
                expectedOutcome: 'What your answer settles marked as settled; the status you set on each row is kept.', needsDecision: false, decisionQuestion: null,
              });
              upsertStep(step);
              const saved: typeof marks = [];
              for (const stageId of [...new Set(marks.map((m) => m.stageId))]) {
                const table = o.template.stages.find((s) => s.id === stageId);
                const head = o.bundles[stageId]?.versions.at(-1);
                const content = withMarks(head?.content, stageId, marks);
                if (!table || !content) continue;
                const here = marks.filter((m) => m.stageId === stageId);
                try {
                  await o.appendStageVersion!(stageId, table.label, {
                    content, source_operation: 'agent_triage', base_content: head?.content ?? '',
                    instruction: 'Marked as settled by the user\'s own answer; no status changed.',
                    model: o.project.model, mode: modeForStage(o.project, table),
                    change_summary: describeSettled(here, stageLabelFor),
                  });
                  saved.push(...here);
                } catch {
                  // Not saved: the rows stay open and are put to the user, as before.
                }
              }
              const said = [
                saved.length ? describeSettled(saved, stageLabelFor) : '',
                ...keptSettled.map((k) => `A question kept for you is answered by what you have said since ("${k.quote.slice(0, 200)}"): ${k.question.slice(0, 200)}`),
              ].filter(Boolean).join(' ');
              upsertStep(await finishAgentStep(step.id, said
                ? { status: 'succeeded', label: null, output: said }
                : { status: 'failed', label: null, output: 'Could not save the rows your answer settles; they stay open.' }));
              if (saved.length) {
                await o.onRefresh?.();
                await settle();
                continue;
              }
            }
          }
        }

        // After a performed move, what the project is now. Three moves that
        // left it exactly as it was is a run going round in circles — the
        // client's log of repeated "Check this stage" / "Apply the findings"
        // (2 Oct, screenshot 7) — and stops here, before another model call.
        // The first read since Go/Resume is the baseline the moves are compared with.
        if (performedRef.current || fingerprintsRef.current.length === 0) {
          const moved = performedRef.current;
          performedRef.current = false;
          const sources = (o.project.sources ?? []).filter((s) => !s.retired_at).length;
          // Exit 0 only: a failed run is labelled "code executed" too; a run that worked says "exit code 0".
          const runsOk = stepsRef.current.filter((s) =>
            s.action_key === 'run_computation' && s.status === 'succeeded' && /\bexit code 0\b/.test(s.output ?? '')
          ).length;
          fingerprintsRef.current.push(stateFingerprint({ state: o.state, bundles: o.bundles, events: freshEvents, facts, stageEvaluation, sources, runsOk }));
          const circling = moved ? noChange(fingerprintsRef.current) : null;
          if (circling) {
            await setRunStatus('blocked', circling);
            break;
          }
        }
        const proposedSkipHere = [...priorStepsRef.current, ...stepsRef.current].some(
          (s) => s.action_key === 'propose_skip' && s.stage_id === o.stage!.id
        );
        // Proposals are asked for once per stage per run — twice under "Handle
        // them for me", for the rows the first pass left (C3, 8 Oct): what the
        // rows still do not settle is the user's.
        const proposedStatusesHere = [...priorStepsRef.current, ...stepsRef.current].filter(
          (s) => s.action_key === 'propose_statuses' && s.stage_id === o.stage!.id
        ).length >= ((o.project.routine_decisions ?? 'ask') === 'handle' ? 2 : 1);
        const polishedHere = polishSinceDirection([...priorStepsRef.current, ...stepsRef.current], o.stage!.id);
        const allowed = withoutSettledRuns(withoutEndlessPolish(
          withoutOverride(
            allowedActions(o.template, o.state, o.stage, hasDraft, toolsFor(o.project), facts), stageEvaluation.canAdvance, current.policy
            // Asked once: if the user stayed, the stage is to be done.
          ).filter((k) => (k !== 'propose_skip' || !proposedSkipHere) && (k !== 'propose_statuses' || !proposedStatusesHere)),
          polishedHere,
          stageEvaluation.canAdvance,
          Boolean(unsavedDerivation([...priorStepsRef.current, ...stepsRef.current], o.stage.id))
        ), facts.review);

        // Runs the data could carry out are tried before the table is handed
        // to the user: at most once per row, so a row no code can settle
        // still ends with the user. Without data, the rows PromptMaster can
        // carry out from what the project states are tried (Q1a, 9 Oct).
        const runsTried = [...priorStepsRef.current, ...stepsRef.current].filter(
          (s) => s.action_key === 'run_computation' && s.stage_id === o.stage!.id
        ).length;
        // A sandbox that is not available now is not tried again for the next row in this window.
        const sandboxDown = stepsRef.current.some((s) => s.action_key === 'run_computation' && s.block_kind === 'tool_missing');
        const runAttemptsLeft = sandboxDown ? 0 : runAttemptsFor(facts.review, allowed, dataFileBriefs(o.project).length > 0, runsTried);

        // On a review table whose rows name sources (Fact-check), they are
        // looked up and read once per stage per run before the table is handed
        // over (5 Oct). Elsewhere looking up stays the planner's choice.
        const lookedUpHere = [...priorStepsRef.current, ...stepsRef.current].some(
          (st) => st.action_key === 'check_literature' && st.stage_id === o.stage!.id
        );
        const lookupDue = !lookedUpHere && Boolean(facts.review) && sourcesToCheck(o.stage, facts.review?.items ?? []);

        // Routine approvals (5 Oct): the project's policy, read each move so a
        // change mid-run applies at once; and the ones whose check failed on
        // the current version, which are revised toward rather than re-checked.
        const routine = o.project.routine_decisions ?? 'ask';
        const headAt = o.bundles[o.stage.id]?.versions.at(-1)?.created_at ?? '';
        const commitTried = [...priorStepsRef.current, ...stepsRef.current]
          .filter((s) => s.action_key === 'commit_delegated' && s.stage_id === o.stage!.id && s.status === 'failed' && (s.finished_at ?? s.started_at ?? '') >= headAt)
          .map((s) => String(s.params?.criterion_id ?? ''));
        if (delegableToCommit(o.stage, stageEvaluation, routine, commitTried)) allowed.push('commit_delegated');
        // Q2 (9 Oct): back to the stage that does the further work the analysis asks for.
        const goBackTo = returnTargets({
          template: o.template, stage: o.stage, policy: current.policy, routine,
          stageText: hasDraft ? (o.bundles[o.stage.id]?.versions.at(-1)?.content ?? '') : '',
          steps: [...priorStepsRef.current, ...stepsRef.current],
        });
        // An answer that names going back is the user's return; Go carries it out (13 Oct).
        const userReturn = answeredReturn(o.template, o.stage, [...priorStepsRef.current, ...stepsRef.current]);
        // An answer that means changing earlier work without saying "go back" (6 Nov):
        // the planner reads it, and goes back itself where the run may.
        const answerReturn = userReturn ? null : returnsForAnswer({
          template: o.template, stage: o.stage, policy: current.policy, routine,
          steps: [...priorStepsRef.current, ...stepsRef.current],
        });
        if (goBackTo.length || userReturn || answerReturn?.mayGo) allowed.push('return_to_stage');
        // 25 Oct: the next task the saved work names becomes a stage of its own
        // — in an investigation, with routine decisions handed to Go, at most
        // three a run (the database holds the same limits).
        if (
          current.policy === 'autonomous' && routine === 'handle' && mayAddStages(o.template) &&
          addedByRun(o.events, current.id) < MAX_ADDED_PER_RUN
        ) allowed.push('add_stage');
        // Q2b: after going round in circles, the repeated moves are off the table for the next choice.
        const reconsider = reconsiderRef.current?.pending ? reconsiderRef.current : null;
        if (reconsider) {
          for (const k of reconsider.withdrawn) {
            const at = allowed.indexOf(k);
            if (at >= 0) allowed.splice(at, 1);
          }
        }
        // 6 Oct: proposals that stand are Go's to confirm under "handle them for me".
        if (policyConfirmable(o.stage, facts, routine) > 0) allowed.push('confirm_proposals');
        // 7 Oct (L-51): attached documents whose facts are not on record yet,
        // read once per run under "handle them for me".
        const factsTried = [...priorStepsRef.current, ...stepsRef.current].some((s) => s.action_key === 'extract_facts');
        if (routine === 'handle' && !factsTried && documentsAwaitingFacts(o.project)) allowed.push('extract_facts');

        // 6 Oct: a stage a change reopened is repaired before anything else —
        // on whichever stage it is — so Summary is not left recommending A.
        // At most twice per stage (REPAIR_TRIES): one that still cannot close is the user's.
        // Tries for the stage's current reopening: a later change reopens it
        // afresh. Counted across the whole chain, a stage that had failed
        // twice before could never be repaired again (8 Oct, production).
        // Each repair step records the reopening it was for (`stale_since`),
        // so no clock is compared.
        const recheckTried = withExtraTries(
          repairTries([...priorStepsRef.current, ...stepsRef.current], o.state, new Set(stepsRef.current.map((s) => s.id))),
          extraTriesRef.current
        );
        const drafted = new Set(Object.entries(o.bundles).filter(([, b]) => (b?.versions.length ?? 0) > 0).map(([id]) => id));
        const holder = deliverableDocument(o.template, o.bundles)?.stage;
        // Once the deliverable is written it can't be "stuck" on anything but
        // itself: what's left is the world's, and gets recorded (7 Nov).
        if (current.policy === 'autonomous' && routine === 'handle' && holder?.id === o.stage.id && (o.bundles[o.stage.id]?.versions.length ?? 0) > 0) {
          const at = allowed.indexOf('mark_blocked');
          if (at >= 0) allowed.splice(at, 1);
        }
        // What the final check found unmet on this very version is repaired the
        // same way, not put to the user as a button (8 Nov): it is routine, and
        // the repair limit still applies.
        const assessed = latestObjectiveAssessment(freshEvents);
        const checkUnmet = holder && assessed && assessed.outcome !== 'met' && !assessed.blockers.length && assessed.basis?.version_id && assessed.basis.version_id === o.bundles[holder.id]?.versions.at(-1)?.id ? (assessed.unmet ?? []) : [];
        const carriedRows = [...Object.values(context.carriedForward ?? {}).flat(), ...checkUnmet];
        const carried = current.policy === 'autonomous' && routine === 'handle' && holder && carriedRows.length
          ? { deliverableId: holder.id, rows: carriedRows }
          : null;
        // After a loop of repairs was withdrawn, the next choice is the
        // planner's, not the same repair forced again (13 Oct).
        const outlineToo = current.policy === 'autonomous' && routine === 'handle';
        const repair = reconsider?.withdrawn.includes('recheck_stage')
          ? null
          : staleRepair(o.template, o.state, recheckTried, context.measured ?? {}, drafted, carried, Object.fromEntries(Object.entries(context.sections ?? {}).filter(([, v]) => v.cut?.length).map(([id, v]) => [id, v.cut!])), outlineToo);
        if (repair) allowed.push('recheck_stage');
        // A reopened stage whose repairs are used up is the user's next
        // decision, said with what is unresolved (13 Oct, screenplay).
        const exhausted = repair ? null : exhaustedRepair(o.template, o.state, recheckTried);
        if (exhausted) {
          const stuck = repairStuckNeed(o.state, exhausted, [...priorStepsRef.current, ...stepsRef.current]);
          await setRunStatus('awaiting_decision', describeNeed(stuck, stageLabelFor).message, stuck);
          break;
        }
        // …and so is a reopened stage Go does not revise (a chapter plan),
        // once everything it can repair is repaired (2 Nov, production).
        const byHand = repair ? null : unrepairableStale(o.template, o.state, outlineToo);
        if (byHand) {
          const stuck = { ...repairStuckNeed(o.state, byHand, [...priorStepsRef.current, ...stepsRef.current]), byHand: true };
          await setRunStatus('awaiting_decision', describeNeed(stuck, stageLabelFor).message, stuck);
          break;
        }

        // Newer fixes left open on the review, with the reason, instead of another trip back.
        const carryFixes = async (fixes: NewerFixes): Promise<boolean> => {
          const here = o.stage;
          if (!o.appendStageVersion || !here) return false;
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: here.id, mode: modeForStage(o.project, here), actionKey: 'confirm_proposals',
            params: { carried_forward: fixes.carried.map((i) => i.id) },
            rationale: `Instead of going back again: one round of accepted fixes was already merged, and the newer ones are routine.`,
            expectedOutcome: 'The newer fixes left open on the review, with the reason; the work goes on.', needsDecision: false, decisionQuestion: null,
          });
          upsertStep(step);
          const output = describeCarried(fixes);
          let failed = false;
          try {
            await o.appendStageVersion(here.id, here.label, {
              content: serializeItems(fixes.items),
              source_operation: 'agent_triage',
              base_content: o.bundles[here.id]?.versions.at(-1)?.content ?? '',
              instruction: 'Carried the newer review fixes forward under the routine-decision policy.',
              model: o.project.model,
              mode: modeForStage(o.project, here),
              change_summary: output,
            });
          } catch {
            failed = true;
          }
          upsertStep(await finishAgentStep(step.id, failed
            ? { status: 'failed', label: null, output: 'Could not save the carried-forward fixes; asking instead.' }
            : { status: 'succeeded', label: null, output }));
          return !failed;
        };

        // Accepted fixes reach the deliverable before anyone is asked to sign it off (6 Nov).
        const isLastReview = effectiveRenderer(o.stage) === 'review' && !o.stage.transitions.default_next;
        const merge = repair || userReturn || !facts.review
          ? null
          : fixesToMerge({
              template: o.template, stage: o.stage, items: facts.review.items,
              undecided: facts.review.material.length + facts.review.routine.length,
              events: freshEvents, versions: o.bundles[o.stage.id]?.versions ?? [], policy: current.policy, routine,
            });
        if (merge && !allowed.includes('return_to_stage')) allowed.push('return_to_stage');
        // …and a later round's are carried forward, not a second trip back.
        const laterRound = !repair && !merge && isLastReview && facts.review
          ? carryNewerFixes({
              question: 'go back to apply the accepted fixes',
              isReviewStage: true, stageId: o.stage.id,
              items: facts.review.items, schema: facts.review.schema, steps: stepsRef.current, events: freshEvents,
              versions: o.bundles[o.stage.id]?.versions ?? [], policy: current.policy, routine,
            })
          : null;
        if (laterRound && (await carryFixes(laterRound))) {
          await o.onRefresh?.();
          continue;
        }

        // "Approve it as it stands": nothing more is checked or applied there.
        const asItStands = approvedAsItStands([...priorStepsRef.current, ...stepsRef.current], o.stage.id);

        // Before the planner is asked: is the next move the user's? (B4)
        // Findings undecided on other stages are named with any approval asked here (2 Nov).
        const openElsewhere = openRowsElsewhere(o.template, o.state, context, o.stage.id);
        const needInput = {
          state: o.state, stage: o.stage, facts, stageEvaluation, allowed, policy: current.policy,
          outlineStageId: outlineStageFor(o.template)?.id ?? null, largeJobAcknowledged: largeJobOkRef.current,
          runAttemptsLeft, lookupDue, routine, commitTried, asItStands, ...(openElsewhere.length ? { openElsewhere } : {}),
        };
        const need = repair || merge ? null : needsUser(needInput);
        if (need) {
          await setRunStatus('awaiting_decision', describeNeed(need, stageLabelFor).message, need);
          break;
        }

        // What the stage itself still requires comes before anything the
        // planner might prefer (4 Oct): a cut-off draft is finished, and at an
        // approval the findings are applied and the work checked first.
        const loops = o.template.stages.some((s) => s.transitions.loop_to);
        // Left to Go with nothing in the text to settle: the planner moves next,
        // told to choose, before any check that never read the answer (5 Nov).
        const lastStep = stepsRef.current.at(-1);
        const justLeftToGo = lastStep?.action_key === USER_ANSWER_STEP && isDelegatedAnswer(lastStep.output ?? '');
        const repairNote = repair ? repairNotesRef.current.get(String(repair.params?.stage_id ?? '')) : undefined;
        if (repair && repairNote) repairNotesRef.current.delete(String(repair.params?.stage_id ?? ''));
        const required = (repair && repairNote ? { ...repair, params: { ...repair.params, user_note: repairNote } } : repair) ?? (userReturn
          ? {
              key: 'return_to_stage',
              rationale: `You chose: "${userReturn.answer.slice(0, 200)}". Going back to ${userReturn.label} to do it.`,
              expected: `The work is back on ${userReturn.label}; the stages after it are rechecked once it changes.`,
              params: { stage_id: userReturn.id, reason: `You chose: ${userReturn.answer}`.slice(0, 1_000), work: userReturn.answer.slice(0, 2_000), by_user: true },
            }
          : null) ?? (merge
          ? {
              key: 'return_to_stage',
              rationale: `${merge.rows.length} accepted finding${merge.rows.length === 1 ? '' : 's'} on ${o.stage.label} ${merge.rows.length === 1 ? 'is' : 'are'} not in ${merge.target.label} yet. Going back to put ${merge.rows.length === 1 ? 'it' : 'them'} in before you are asked to sign off.`,
              expected: `${merge.target.label} revised with the accepted findings; ${o.stage.label} reads it again.`,
              params: {
                stage_id: merge.target.id,
                reason: `The accepted findings on ${o.stage.label} are not in ${merge.target.label} yet.`,
                work: `Apply the ${merge.rows.length} accepted finding${merge.rows.length === 1 ? '' : 's'} from ${o.stage.label}.`,
              },
            }
          : null) ?? (justLeftToGo ? null : requiredWork({
          stage: o.stage, facts, stageEvaluation, allowed, lookupDue, routine, commitTried, runAttemptsLeft, asItStands,
          ...(loops ? { round: { staleDraft: stageDrafts(o.stage) && !hasDraft } } : {}),
        }));
        const planNext = () => planning(() => api.agentNextAction(
              {
                inputs: inputsFrom(o.project),
                state: buildAgentState({
                  template: o.template, state: o.state, stage: o.stage!, bundles: o.bundles,
                  stageEvaluation, latestEvaluation: o.latestEvaluation, steps: [...priorStepsRef.current, ...stepsRef.current],
                  context, approvedOutline: o.approvedOutline, facts, dataFiles: dataFileBriefs(o.project), tools: toolsFor(o.project), routine: o.project.routine_decisions ?? undefined, delegation: delegationSentences(o.project), memory: reconsider ? [reconsider.note, ...memory].slice(0, 24) : memory, controls: o.getControls?.() ?? undefined,
                  returnTargets: goBackTo.length || !answerReturn?.mayGo ? goBackTo : answerReturn.stages,
                  answerReturn,
                  lengthNote: holder?.id === o.stage!.id ? describeLengthTarget(wholeLengthTarget(o.project, o.bundles[o.stage!.id]?.versions.at(-1)?.content ?? '')) : '',
                  // Said, not silently withheld (4 Nov, Lakeside): "I cannot make that edit from here".
                  polishPaused: polishCapped(polishedHere, stageEvaluation.canAdvance) && !allowed.includes('revise_stage') ? polishedHere : undefined,
                  // What already waits on the user anywhere in the project (12 Nov): not asked one by one.
                  waitingOnUser: queueLines(userQueue({
                    template: o.template, state: o.state, outstanding: outstandingWork(o.template, o.state, context),
                    bundles: o.bundles, manualChecks: o.project.manual_checks, routine,
                    kept: keptQuestions([...priorStepsRef.current, ...stepsRef.current], answeredKept(o.project.facts, [...priorStepsRef.current, ...stepsRef.current])),
                  })),
                }),
                allowed_actions: allowed, policy: current.policy, model: o.project.model,
              },
              signal
            ));
        const firstChoice = required
          ? {
              action_key: required.key, params: required.params ?? {}, rationale: required.rationale, expected_outcome: required.expected,
              needs_user_decision: false, decision_question: null,
            }
          : await planNext();
        // A reply the planner could not make usable is PromptMaster's failure,
        // not a question for the user: it is asked once more (8 Nov, production).
        const choice = !required && !signal.aborted && typeof firstChoice.params?.unplanned === 'string' ? await planNext() : firstChoice;
        if (signal.aborted) throw new Stopped();
        if (reconsider) reconsiderRef.current = { ...reconsider, pending: false };
        // A reasoning move repeated while its last result is unsaved becomes
        // the save of that result (9 Oct, production: Derive ×3, nothing saved).
        const saving = required ? null : saveInsteadOfRepeating(choice, [...priorStepsRef.current, ...stepsRef.current], o.stage.id, allowed, hasDraft, stageEvaluation.canAdvance);
        if (saving) Object.assign(choice, saving, { needs_user_decision: false, decision_question: null });
        // Nor is an unchanged deliverable judged again (9 Oct, production).
        const moving = required ? null : moveOnInsteadOfRejudging(choice, [...priorStepsRef.current, ...stepsRef.current], o.stage.id, allowed, stageEvaluation.canAdvance);
        if (moving) Object.assign(choice, moving, { needs_user_decision: false, decision_question: null });
        // A second round of review fixes is carried forward, not another trip back (19 Oct, FIELDGUIDE).
        const performer = actionFor(choice.action_key)?.performer;
        const newerFixes = !required && (performer === 'ask' || performer === 'return') && facts.review && o.appendStageVersion
          ? carryNewerFixes({
              question: `${choice.decision_question ?? ''} ${choice.rationale ?? ''}`,
              isReviewStage: effectiveRenderer(o.stage) === 'review', stageId: o.stage.id,
              items: facts.review.items, schema: facts.review.schema, steps: stepsRef.current, events: freshEvents,
              versions: o.bundles[o.stage.id]?.versions ?? [], policy: current.policy, routine,
            })
          : null;
        if (newerFixes && (await carryFixes(newerFixes))) {
          await o.onRefresh?.();
          continue;
        }
        // Nor is going back for the fixes it just carried forward (19 Oct, FIELDGUIDE).
        const carriedNote = !required && (performer === 'ask' || performer === 'return') && facts.review && allowed.includes('declare_objective_complete')
          ? reasksCarried({
              question: `${choice.decision_question ?? ''} ${choice.rationale ?? ''}`,
              isReviewStage: effectiveRenderer(o.stage) === 'review',
              items: facts.review.items, policy: current.policy, routine,
            })
          : null;
        if (carriedNote) {
          Object.assign(choice, { action_key: 'declare_objective_complete', params: {}, rationale: carriedNote, expected_outcome: 'The objective judged with the carried-forward fixes named.', needs_user_decision: false, decision_question: null });
        }
        // A move the planner chose that isn't on offer: say what the stage is waiting
        // for, rather than "what would you like to do next?" (8 Nov, production).
        if (!required && typeof choice.params?.unplanned === 'string') {
          const waitingOn = needsUser({ ...needInput, allowed: [] });
          if (waitingOn) {
            await setRunStatus('awaiting_decision', describeNeed(waitingOn, stageLabelFor).message, waitingOn);
            break;
          }
          const fallbackMove = unplannedMove(hasDraft, allowed);
          if (fallbackMove) Object.assign(choice, fallbackMove);
        }
        // Before a question interrupts the user: does it hold the work up? (Q1b)
        if (!required && actionFor(choice.action_key)?.performer === 'ask') {
          // The way back kept the planner in the loop only so it could read the answer.
          // It asked instead: what the stage is waiting for gets its own card, with its
          // own box, as it would have without that offer (6 Nov).
          const waiting = answerReturn?.mayGo && !goBackTo.length
            ? needsUser({ ...needInput, allowed: allowed.filter((k) => k !== 'return_to_stage') })
            : null;
          if (waiting) {
            await setRunStatus('awaiting_decision', describeNeed(waiting, stageLabelFor).message, waiting);
            break;
          }
          const nextId = nextSuggestedStage(o.template, o.state);
          const question = choice.decision_question || choice.rationale || '';
          // A choice whose default the question itself names is routine under
          // "handle them for me": taken, recorded as a fact the user can
          // change, and the work goes on — once per stage per window.
          const fallback = proposedDefault(question);
          if (
            fallback && current.policy === 'autonomous' && routine === 'handle' && !touchesObjective(question) &&
            !stepsRef.current.some((s) => s.stage_id === o.stage!.id && s.action_key === ROUTINE_DEFAULT_STEP)
          ) {
            const statement = `Routine default taken by Go under your routine-decision policy (yours to change): ${fallback}`;
            const step = await startAgentStep({
              runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
              stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: ROUTINE_DEFAULT_STEP, params: { question: question.slice(0, 1000) },
              rationale: `Instead of asking "${question.slice(0, 200)}", taking the default it names: routine decisions are mine to handle.`,
              expectedOutcome: 'The default on record as a fact every later stage uses.', needsDecision: false, decisionQuestion: null,
            });
            upsertStep(step);
            let output: string;
            try {
              await recordRoutineDefault(o.project, current.id, { statement, stageId: o.stage.id, question });
              output = `${statement}. Change it in Facts and requirements if you want something else; the stages that use it will be reopened.`;
            } catch (e) {
              output = `Could not record the default (${(e as Error).message}); asking instead.`;
            }
            upsertStep(await finishAgentStep(step.id, { status: output.startsWith('Could not') ? 'failed' : 'succeeded', label: null, output }));
            if (!output.startsWith('Could not')) {
              await o.onRefresh?.();
              continue;
            }
          }
          // A question already asked and answered, with nothing the user
          // changed since, is not asked again: the run pauses once and says
          // so (4 Nov, Sean, Lakeside: three questions about the same notes,
          // $1.81 → $2.61).
          const repeat = repeatedQuestion({
            question, control: typeof choice.params?.control === 'string' ? choice.params.control : null, stageId: o.stage.id,
            steps: [...priorStepsRef.current, ...stepsRef.current],
            versions: o.bundles[o.stage.id]?.versions ?? [], facts: o.project.facts ?? [],
          });
          if (repeat) {
            // With somewhere to answer: "tell me what to do differently" over a
            // blocked run had no box, and Resume only fired this again (5 Nov).
            await setRunStatus('awaiting_decision', repeatPause(repeat, o.stage.label, question), { kind: 'answer_question', question, repeat: true });
            break;
          }
          const screenPlan = await screenStop(o, o.stage, question, allowed, Boolean(choice.params?.expert_package) || needsExpert(question));
          if (screenPlan.kind === 'record') {
            await o.onRefresh?.();
            continue;
          }
          if (screenPlan.kind === 'repair') {
            Object.assign(choice, { ...screenPlan.move, needs_user_decision: false, decision_question: null });
          } else {
          const { audit, instead } = auditStop({
            question, stageLabel: o.stage.label, nextStageLabel: nextId ? stageLabelFor(nextId) : null,
            allowed, canAdvance: stageEvaluation.canAdvance, policy: current.policy, routine,
            setAsideBefore: stepsRef.current.some((s) => s.stage_id === o.stage!.id && typeof s.params?.set_aside_question === 'string'),
            touchesObjective: touchesObjective(question),
          });
          if (instead) {
            Object.assign(choice, {
              action_key: instead.key, rationale: instead.rationale, expected_outcome: instead.expected,
              params: { set_aside_question: question.slice(0, 1000) }, needs_user_decision: false, decision_question: null,
            });
          } else {
            choice.params = { ...(choice.params ?? {}), stop_audit: describeAudit(audit) };
            // Q3a: a question only an expert can answer is asked with the package an expert needs.
            // Not on a check stage: its findings are decided in its table, not
            // sent to a specialist (Sean, 10 Oct, email 7.2: eight Critique
            // findings arrived as one long expert-review question).
            if (needsExpert(question) && effectiveRenderer(o.stage) !== 'review') {
              setPhase('thinking');
              const pkg = await api.agentExpertPackage({
                inputs: inputsFrom(o.project), issue: question.slice(0, 2_000), stage_label: o.stage.label,
                documents: recordDocuments(o.template, o.state, o.bundles), model: o.project.model,
                web_access: webAccessOf(o.project),
              }, signal).catch(() => null);
              if (pkg) await keepFound(o.project, pkg, { stageId: o.stage.id, agentRunId: current.id });
              if (pkg) choice.params = { ...choice.params, expert_package: packageMarkdown(pkg, o.project.title) };
            }
          }
          }
        }
        // Marked stuck is a stop too, and gets the same reading (8 Nov).
        if (!required && actionFor(choice.action_key)?.performer === 'block') {
          const blockPlan = await screenStop(o, o.stage, String(choice.params?.reason ?? choice.rationale ?? ''), allowed, false);
          if (blockPlan.kind === 'record') {
            await o.onRefresh?.();
            continue;
          }
          if (blockPlan.kind === 'repair') Object.assign(choice, { ...blockPlan.move, needs_user_decision: false, decision_question: null });
        }
        if (!fitsBudget(choice.action_key, current.steps_used, current.budget_steps)) {
          await setRunStatus(
            'budget_exhausted',
            `Stopped before "${actionLabel(choice.action_key)}": it needs ${stepCost(choice.action_key)} steps and ${current.budget_steps - current.steps_used} remain.`,
            { kind: 'continue_budget', budgetSteps: current.budget_steps }
          );
          break;
        }

        const step = await startAgentStep({
          runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
          stageId: o.stage.id, mode: modeForStage(o.project, o.stage), actionKey: choice.action_key,
          params: { ...(choice.params ?? {}), ...('decision_choices' in choice && choice.decision_choices?.length ? { choices: choice.decision_choices } : {}) },
          rationale: choice.rationale, expectedOutcome: choice.expected_outcome,
          needsDecision: choice.needs_user_decision, decisionQuestion: choice.decision_question,
        });
        upsertStep(step);

        // A question, or a suggestion to skip, is itself the pause.
        const asking = ['ask', 'skip'].includes(actionFor(choice.action_key)?.performer ?? '');
        if (!asking && shouldPause(current.policy, choice.action_key, choice.needs_user_decision, { routine, canAdvance: stageEvaluation.canAdvance })) {
          await setAgentStepStatus(step.id, 'awaiting_decision');
          upsertStep({ ...step, status: 'awaiting_decision' });
          await setRunStatus('awaiting_decision', `Waiting for your approval: ${actionLabel(choice.action_key)}.`);
          setPendingStepId(step.id);
          setPhase('awaiting');
          return;
        }
        if ((await perform(step, false, signal)) === 'stop') break;
      }
      setPhase('ended');
      // A window used up under Autonomous, with further windows authorized
      // in advance: carry on, recording the window as it starts.
      const ended = runRef.current;
      if (ended?.status === 'budget_exhausted' && ended.policy === 'autonomous' && autoLeftRef.current > 0 && !callCapRef.current) {
        autoLeftRef.current -= 1;
        void continueRef.current(true).finally(() => setAutoPending(autoLeftRef.current > 0));
      }
    } catch (e) {
      if (e instanceof Stopped || signal.aborted) return;
      // Postgrest throws plain objects; say what actually went wrong (client, 21 Oct).
      const err = asError(e, 'Go mode hit an error.');
      const message = err.message;
      setError(message);
      const running = stepsRef.current.filter((x) => x.status === 'running');
      void recordErrorEvent({
        code: err.code ? `go_${err.code}` : 'go_error', title: 'Go stopped', message,
        technical: [err.details, err.hint, running.map((s) => s.action_key).join(', ')].filter(Boolean).join(' · '),
        route: 'go', projectId: latest.current.project.id,
      });
      // A step whose close-out was refused (e.g. the database rejected a
      // label) must not sit "in progress" forever. One whose work happened
      // keeps its outcome, with the missing record said.
      for (const s of running) {
        const kept = e instanceof StepNotRecorded ? e.outcome : null;
        const closed = await finishAgentStep(s.id, kept
          ? { status: kept.status, label: kept.label, output: `${kept.output}\n\nThis step's own record could not be saved (${message}); what it did is in the project.`, blockKind: kept.blockKind ?? null, toolsUsed: kept.toolsUsed, changes: kept.changes }
          : { status: 'failed', label: null, output: `Could not record this step: ${message}` }
        ).catch(() => null);
        if (closed) upsertStep(closed);
      }
      // A planner or bookkeeping failure: record it rather than leave the run "running".
      await setRunStatus('failed', message).catch(() => undefined);
      setPhase('ended');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [perform, setRunStatus, upsertStep, stageLabelFor]);

  // --- controls -----------------------------------------------------------------

  const startRun = useCallback(
    async (chosen: ExecutionPolicy, authorizationId: string | null) => {
      const o = latest.current;
      const live = runRef.current;
      if (live && !live.ended_at && live.status !== 'running') {
        await endAgentRun(live.id, 'stopped', 'Superseded by a new Go.');
      }
      // What the last run did, and anything the user told it, stays in front
      // of the planner. Answering a question and then pressing Go under a
      // different policy used to start from nothing: the answer was recorded
      // on a run the planner never read again.
      const carried = live && live.status !== 'completed' ? [...priorStepsRef.current, ...stepsRef.current] : [];
      let created: AgentRun;
      try {
        created = await createAgentRun({
          projectId: o.project.id, userId: o.project.user_id, policy: chosen,
          authorizationId, budgetSteps: budget, leaseHolder: tabId.current,
        });
      } catch (e) {
        // A run started meanwhile, here or in another tab: follow it rather
        // than show the database's refusal.
        const found = isDuplicateRun(e) ? await getLiveAgentRun(o.project.id).catch(() => null) : null;
        if (!found) throw e;
        await adoptRef.current(found);
        return;
      }
      commitRun(created);
      commitSteps([]);
      setPrior(carried);
      largeJobOkRef.current = null;
      followRef.current = null;
      sinceRef.current = 0;
      fingerprintsRef.current = [];
      reconsiderRef.current = null;
      performedRef.current = false;
      autoLeftRef.current = chosen === 'autonomous' ? autoWindows : 0;
      setAutoPending(autoLeftRef.current > 0);
      void loop();
    },
    [budget, autoWindows, commitRun, commitSteps, loop, setPrior]
  );

  /**
   * Another window (B4, Sean item 3): the same policy under the same
   * authorization, chained to the run whose window was used up, with that
   * run's steps kept as history for the planner. Each window is the user's
   * click; when the policy needed an authorization, the click is recorded
   * against it.
   */
  const continueRun = useCallback(async (auto = false) => {
    // A window Go starts on its own keeps counting; the user's click starts afresh (4 Nov).
    if (!auto) freshAllowance();
    const o = latest.current;
    const prev = runRef.current;
    if (!prev || prev.status !== 'budget_exhausted') {
      setError('There is no used-up window to continue. Press Go to start one.');
      return;
    }
    setError(null);
    try {
      let created: AgentRun;
      try {
        created = await createAgentRun({
          projectId: o.project.id, userId: o.project.user_id, policy: prev.policy,
          authorizationId: prev.authorization_id, budgetSteps: prev.budget_steps, leaseHolder: tabId.current,
          continuesRunId: prev.id, autoContinued: auto,
        });
      } catch (e) {
        const found = isDuplicateRun(e) ? await getLiveAgentRun(o.project.id).catch(() => null) : null;
        if (!found) throw e;
        await adoptRef.current(found);
        return;
      }
      if (prev.authorization_id) {
        const windows = priorStepsRef.current.length ? 2 + Math.floor(priorStepsRef.current.length / Math.max(1, prev.budget_steps)) : 2;
        await recordDecision(o.project.id, o.project.user_id, {
          decision_type: 'accept_recommendation',
          recommendation_id: prev.authorization_id,
          rationale: auto
            ? `Go mode continued for ${prev.budget_steps} more steps on its own, as authorized in advance.`
            : `Continue Go mode for ${prev.budget_steps} more steps.`,
          metadata: { continues_run_id: prev.id, window: windows, auto },
        }).catch(() => undefined);
      }
      setPrior([...priorStepsRef.current, ...stepsRef.current]);
      setPolicy(prev.policy);
      setBudget(prev.budget_steps);
      commitRun(created);
      commitSteps([]);
      followRef.current = null;
      sinceRef.current = 0;
      fingerprintsRef.current = [];
      reconsiderRef.current = null;
      performedRef.current = false;
      void loop();
    } catch (e) {
      // A window the loop tried to start itself and the database refused is
      // not an error to show: the used-up window's own card asks for the click.
      if (auto) autoLeftRef.current = 0;
      else setError(asError(e, 'Could not continue Go mode.').message);
    }
  }, [commitRun, commitSteps, loop, freshAllowance, setPrior]);
  continueRef.current = continueRun;

  /**
   * Go in one click (17 Oct, Sean: "do we need it if the versions are saved
   * anyway?"). Nothing a run does can destroy a version — every save appends —
   * so the separate "Authorize and go" dialog is gone. The authorization it
   * wrote stays: pressing Go with Checkpoint or Autonomous records the same
   * accepted proposal and decision, with the window and the further windows
   * shown beside the button, and the database still refuses a run without it.
   */
  const authorizeAndStart = useCallback(
    async (chosen: Exclude<ExecutionPolicy, 'guided'>) => {
      const o = latest.current;
      if (startingRef.current) return;
      if (!o.stage) {
        setError('Go has no stage to start from yet. Reload the page and press Go.');
        return;
      }
      startingRef.current = true;
      setAuthorizing(chosen);
      try {
        const authId = await authorizeRun({
          projectId: o.project.id, userId: o.project.user_id, policy: chosen, budgetSteps: budget, stageId: o.stage.id,
          autoContinueWindows: chosen === 'autonomous' ? autoWindows : 0,
        });
        await startRun(chosen, authId);
      } finally {
        startingRef.current = false;
        setAuthorizing(null);
      }
    },
    [budget, autoWindows, startRun]
  );

  /** Puts a stage one try short of the limit: "Try once more" must try, however many it has had. */
  const allowOneMoreRepair = useCallback((stageId: string) => {
    const tried = repairTries([...priorStepsRef.current, ...stepsRef.current], latest.current.state, new Set(stepsRef.current.map((s) => s.id)));
    extraTriesRef.current.set(stageId, extraTriesForOneMore(tried, stageId, extraTriesRef.current.get(stageId)));
  }, []);

  const go = useCallback(async () => {
    // This tab's loop is already running, or a Go is still being started: a
    // second one found the run "running", matched no resume, started a new run,
    // and adopting the first closed its step in flight as interrupted (12 Nov).
    if (abortRef.current || goingRef.current) return;
    goingRef.current = true;
    setError(null);
    freshAllowance();
    if (phaseRef.current === 'watching') {
      setError(WATCHING_ELSEWHERE);
      goingRef.current = false;
      return;
    }
    let live = runRef.current;
    try {
      // What this tab holds may be out of date: another tab can have resumed
      // or replaced the run since. Follow the run as it is now.
      const now = await getLiveAgentRun(latest.current.project.id).catch(() => undefined);
      if (now && (drivenElsewhere(now, tabId.current) || (now.id !== live?.id && now.status === 'running'))) {
        await adoptRef.current(now);
        return;
      }
      if (now && now.id === live?.id) live = now;
      // Resume a paused run of the same policy rather than starting over:
      // it keeps its budget and its history.
      if (live && !live.ended_at && live.policy === policy && (live.status === 'blocked' || live.status === 'awaiting_decision') && !pendingStepId) {
        // Resume on a repair that did not settle is "Try once more": without
        // the extra try the same used-up repair stopped the run again at once.
        if (live.needs?.kind === 'repair_stuck') allowOneMoreRepair(live.needs.stageId);
        sinceRef.current = stepsRef.current.length;
        fingerprintsRef.current = [];
        reconsiderRef.current = null;
        performedRef.current = false;
        await updateAgentRun(live.id, { status: 'running', stop_reason: null, needs: null, lease_holder: tabId.current, heartbeat_at: new Date().toISOString() });
        commitRun({ ...live, status: 'running', stop_reason: null, needs: null });
        void loop();
        return;
      }
      // A used-up window, same policy, same size: the next window of the same
      // work, with its history — not a new run that starts from nothing.
      if (live && live.status === 'budget_exhausted' && live.policy === policy && live.budget_steps === budget) {
        await continueRun();
        return;
      }
      if (policy === 'guided') await startRun('guided', null);
      else await authorizeAndStart(policy);
    } catch (e) {
      setError(asError(e, 'Could not start Go mode.').message);
    } finally {
      goingRef.current = false;
    }
  }, [policy, budget, pendingStepId, commitRun, loop, startRun, continueRun, authorizeAndStart, freshAllowance]);

  /**
   * "Update affected work and resume" (D2): repairing every reopened stage
   * takes several steps. A paused run with only a step or two left in its
   * window spent them on the first repair and stopped (8 Oct, production), so
   * a nearly spent window is closed and the next one opened instead.
   */
  const update = useCallback(async (chosen: ExecutionPolicy = policy) => {
    await pressRef.current.run(async () => {
      // Decisions chosen in the table but not saved: as far as Go can read, the
      // rows are still undecided, so Resume stopped again at once and said nothing
      // (6 Nov, production, book test). They are saved first, as an outline's
      // unsaved edits are before its approval.
      const unsaved = latest.current.unsavedRows;
      if (unsaved && waitingOnTable(runRef.current?.needs, unsaved.stageId)) {
        try {
          await unsaved.save();
        } catch (e) {
          setError(asError(e, 'Could not save your decisions, so Go has not resumed.').message);
          return;
        }
      }
      if (phaseRef.current === 'watching') {
        setError(WATCHING_ELSEWHERE);
        return;
      }
      freshAllowance();
      const live = runRef.current;
      const left = live ? live.budget_steps - stepsRef.current.length : 0;
      if (live && !live.ended_at && live.policy === chosen && (live.status === 'blocked' || live.status === 'awaiting_decision') && left < 4 && !pendingStepId) {
        try {
          await updateAgentRun(live.id, { status: 'budget_exhausted', stop_reason: 'Window closed to update affected work.', needs: null });
          commitRun({ ...live, status: 'budget_exhausted', needs: null });
          await continueRun();
          return;
        } catch (e) {
          setError(asError(e, 'Could not start updating the affected work.').message);
          return;
        }
      }
      if (chosen !== policy) {
        setError(null);
        setPolicy(chosen);
        try {
          await authorizeAndStart(chosen as Exclude<ExecutionPolicy, 'guided'>);
        } catch (e) {
          setError(asError(e, 'Could not start updating the affected work.').message);
        }
        return;
      }
      await go();
    });
  }, [policy, pendingStepId, commitRun, continueRun, go, authorizeAndStart, freshAllowance]);

  /**
   * "Apply and continue": the button says Go updates the work and carries on,
   * so the press is the go-ahead. Under Guided — the policy a project starts
   * with — it used to propose one step and wait, the bar disappeared, and
   * nothing changed (14 Oct call: "I didn't feel like that button was working
   * sometimes"). Checkpoint was not enough either: the recheck of the work
   * the change reopened is an important move, so Checkpoint stopped on it
   * and asked again (21 Oct, production pass). The press authorizes an
   * Autonomous run, recorded as pressing Go with Autonomous is; reserved
   * approvals and real questions still stop it. Go's own button keeps the
   * policy chosen there.
   */
  const applyAndContinue = useCallback(() => update('autonomous'), [update]);

  /**
   * PM-23: "next logical action; why it is recommended; ability to apply".
   * One Guided proposal — the planner's best move with its rationale, waiting
   * for one click. Nothing runs until the user says Do it.
   */
  const suggest = useCallback(async () => {
    if (abortRef.current) return;
    if (pendingStepId) {
      setError('A move is already waiting for your decision above.');
      return;
    }
    setError(null);
    setPolicy('guided');
    try {
      await startRun('guided', null);
    } catch (e) {
      setError(asError(e, 'Could not suggest a move.').message);
    }
  }, [pendingStepId, startRun]);

  /**
   * "Let Go run this" (Harold, via Sean, 9 Oct: a new user should give it a
   * goal and see work happen, not configure a run). Autonomous, started at
   * once and recorded as authorized. Reserved approvals still stop the run.
   */
  const handsOff = useCallback(() => {
    if (runRef.current && !runRef.current.ended_at) return;
    setError(null);
    setPolicy('autonomous');
    void authorizeAndStart('autonomous').catch((e) => setError(asError(e, 'Could not start Go mode.').message));
  }, [authorizeAndStart]);

  const approve = useCallback(async () => {
    const id = pendingStepId;
    const step = stepsRef.current.find((s) => s.id === id);
    const current = runRef.current;
    if (!step || !current) return;
    setPendingStepId(null);
    // Never perform a move on a stage other than the one it was planned for:
    // approving a stale "move to the next stage" after a manual advance used
    // to advance whatever stage was current (A5).
    const nowOn = latest.current.state.current_stage_id;
    if (step.stage_id !== nowOn) {
      const was = getStage(latest.current.template, step.stage_id)?.short_label ?? step.stage_id;
      const now = getStage(latest.current.template, nowOn)?.short_label ?? nowOn;
      const closed = await finishAgentStep(step.id, {
        status: 'cancelled', label: null,
        output: `Planned for ${was}; the project is now on ${now}. Not performed.`,
      });
      upsertStep(closed);
      await setRunStatus('stopped', `That move was planned for ${was}; the project is now on ${now}. Press Go to plan again.`);
      setPhase('ended');
      return;
    }
    // …nor one planned before the stage last changed (Sean, 5 Oct: "an approval
    // that was valid when work started may no longer be sufficient when it
    // finishes"). The card offers "Propose again" then; this holds even if
    // Approve was pressed first.
    const lastVersion = latest.current.bundles[step.stage_id]?.versions.at(-1);
    if (plannedBeforeLatestChange(step, [lastVersion?.created_at, latest.current.latestEvaluation?.created_at])) {
      const closed = await finishAgentStep(step.id, {
        status: 'cancelled', label: null,
        output: 'The stage changed after this move was planned. Not performed; it is planned again from the stage as it is now.',
      });
      upsertStep(closed);
      await setRunStatus('stopped', 'The stage changed after that move was planned, so it was not performed. Press Go to plan again.');
      setPhase('ended');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    // The loop takes over with a controller of its own; on every other way out
    // this one is let go, or Go and Resume would read "still running" (12 Nov).
    let handedOn = false;
    try {
      await setAgentStepStatus(step.id, 'running');
      await setRunStatus('running', null);
      upsertStep({ ...step, status: 'running' });
      if ((await perform({ ...step, status: 'running' }, true, controller.signal)) === 'stop') {
        setPhase('ended');
        return;
      }
      handedOn = true;
      void loop();
    } catch (e) {
      if (e instanceof Stopped) return;
      setError(asError(e, 'That step failed.').message);
    } finally {
      if (!handedOn && abortRef.current === controller) abortRef.current = null;
    }
  }, [pendingStepId, perform, loop, setRunStatus, upsertStep]);

  const decline = useCallback(async () => {
    const id = pendingStepId;
    if (!id) return;
    setPendingStepId(null);
    const closed = await finishAgentStep(id, { status: 'cancelled', label: null, output: 'Declined by you.' });
    upsertStep(closed);
    await setRunStatus('stopped', `You declined "${actionLabel(closed.action_key)}".`);
    setPhase('ended');
  }, [pendingStepId, setRunStatus, upsertStep]);

  /**
   * Answer the question the run stopped on. Recorded as a step of its own, so
   * the planner reads it in the history and the trail shows who decided what.
   */
  // L-65 (9 Oct): an answer's claims about the saved record are read against
  // it before it becomes a fact. A contradiction with a verbatim quote is put
  // to the user; anything else — including a failed check — lets it through.
  const checkAnswer = useCallback(async (text: string): Promise<AnswerContradiction | null> => {
    const current = runRef.current;
    const o = latest.current;
    if (!current || !text.trim()) return null;
    const asked = current.needs?.kind === 'answer_question' ? current.needs.question : current.stop_reason ?? '';
    try {
      const res = await api.agentCheckAnswer({
        question: asked, answer: text.trim(), model: o.project.model,
        documents: [...answerDocuments(o.template, o.bundles), ...measuredDocument(o.template, o.context.measured ?? {})],
      });
      return res.contradicts && res.quote ? res : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Reopen the deliverable the objective check judged, with why, so Go's
   * repair revises it (L-64). Returns the unmet assessment, or null when
   * there is none to act on.
   */
  const reopenJudged = useCallback(async (title: string, why: string) => {
    const o = latest.current;
    const unmet = objectiveUnmet(o.events);
    // The stage the check read, as it recorded (5 Nov): not the chapters, when a later stage holds the work.
    const judged = o.template.stages.find((s) => s.id === unmet?.basis?.stage_id) ?? deliverableDocument(o.template, o.bundles)?.stage;
    const judgedStatus = judged ? o.state.stages[judged.id]?.status : undefined;
    if (judged && unmet && (isDone(judgedStatus) || judgedStatus === 'in_progress')) {
      await appendWorkflowEvent(o.project.id, o.project.user_id, {
        type: 'brief_changed', stage_id: judged.id, actor: 'user', reason: title,
        payload: { field: 'facts', kind: 'answer', affected: [{ stage_id: judged.id, reason: why }] },
      });
    }
    return unmet;
  }, []);

  /**
   * "Have Go fix it" on the objective check's card (11 Oct): the deliverable
   * is reopened with what was found unmet as the reason, and Go repairs it,
   * saves a new version and checks again — no answer to type.
   */
  /** "Try once more" on a repair that did not settle: one more try for that stage, then Go carries on (13 Oct). */
  const retryRepair = useCallback(
    async (stageId: string, note?: string) => {
      await pressRef.current.run(async () => {
        // What the user said to fix goes with that one repair (8 Nov: "a way to
        // request a specific repair and rerun the relevant check").
        if (note?.trim()) repairNotesRef.current.set(stageId, note.trim().slice(0, 1_000));
        allowOneMoreRepair(stageId);
        await go();
      });
    },
    [go, allowOneMoreRepair]
  );

  const fixObjective = useCallback(
    async (items: readonly string[]) => {
      const o = latest.current;
      if (phaseRef.current === 'watching') {
        setError(WATCHING_ELSEWHERE);
        return;
      }
      if (abortRef.current) return;
      await pressRef.current.run(async () => {
        try {
          const unmet = await reopenJudged(
            FIX_OBJECTIVE_REASON,
            `the objective check found these unmet — fix each, keep everything else the brief asks for: ${items.join('; ').slice(0, 800)}`
          );
          if (unmet) await Promise.all([o.onRefresh?.(), o.reloadEvents()]);
          await go();
        } catch (e) {
          setError(asError(e, 'Could not reopen the deliverable.').message);
        }
      });
    },
    [go, reopenJudged]
  );

  const answer = useCallback(
    async (text: string, contradicted?: AnswerContradiction) => {
      const current = runRef.current;
      const o = latest.current;
      if (!current || !o.stage || !text.trim()) return;
      if (phaseRef.current === 'watching') {
        setError(WATCHING_ELSEWHERE);
        return;
      }
      // The run is already carrying on, or this answer is still being recorded:
      // a second press would record it twice and start a second loop (12 Nov).
      if (abortRef.current) return;
      const stage = o.stage;
      await pressRef.current.run(async () => {
        try {
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: stage.id, mode: modeForStage(o.project, stage), actionKey: USER_ANSWER_STEP, params: {},
            rationale: '', expectedOutcome: '', needsDecision: false, decisionQuestion: null,
          });
          upsertStep(await finishAgentStep(step.id, { status: 'succeeded', label: null, output: text.trim() }));
          // The answer is a decision of record, not only a line in this run
          // (Sean, 7 Oct, emails 8 and 11): evaluation, the final review and the
          // objective check read the project's facts, never the run's steps.
          const asked = current.needs?.kind === 'answer_question' ? current.needs.question : current.stop_reason ?? '';
          const fact = answerAsFact(asked, text, {
            run_id: current.id, step_id: step.id, stage_id: stage.id,
            // Recorded knowing the record says otherwise: kept with the fact.
            ...(contradicted ? { contradicted: { document: contradicted.document, quote: contradicted.quote } } : {}),
          });
          if (fact) await recordFacts(o.project, [fact]);
          // A stage stuck on that decision is no longer stuck.
          const st = o.state.stages[stage.id];
          if (st?.status === 'blocked' && st.blocked?.kind === 'needs_decision') {
            await appendWorkflowEvent(o.project.id, o.project.user_id, {
              type: 'stage_unblocked', stage_id: stage.id, actor: 'user', reason: `Answered: ${text.trim().slice(0, 300)}`,
            });
          }
          // L-64 (9 Oct): an answer to "the objective is not met" corrects the
          // deliverable that was judged, so it is reopened with the answer as the
          // reason, and Go's repair revises it. Matching the answer to the text
          // it corrects is not possible in code; the judged stage is known.
          const leftToGo = isDelegatedAnswer(text);
          const onObjective = /objective is not met/i.test(current.stop_reason ?? '');
          // "Do whatever is best" on a question the text can settle: the stage is
          // reopened to decide it, so the repair comes before any check (5 Nov).
          const head = o.bundles[stage.id]?.versions.at(-1)?.content ?? '';
          const reopensForChoice = leftToGo && !onObjective && stage.renderer === 'prose' && st?.status !== 'blocked' &&
            settlesInTheText(asked, current.needs?.kind === 'answer_question' ? current.needs.choices : undefined, head);
          if (reopensForChoice) {
            await appendWorkflowEvent(o.project.id, o.project.user_id, {
              type: 'brief_changed', stage_id: stage.id, actor: 'user', reason: 'Left to Go to decide',
              payload: { field: 'facts', kind: 'answer', affected: [{ stage_id: stage.id, reason: delegatedWhy(asked) }] },
            });
          }
          // Left to Go is not the user's word on how to fix it, so it does not start the repair count again.
          const unmet = onObjective
            ? await reopenJudged(leftToGo ? FIX_OBJECTIVE_REASON : ANSWER_OBJECTIVE_REASON, `your answer to "${asked.slice(0, 240)}" was: ${text.trim().slice(0, 600)}`)
            : objectiveUnmet(o.events);
          if (fact || st?.status === 'blocked' || unmet || reopensForChoice) {
            await Promise.all([o.onRefresh?.(), o.reloadEvents()]);
          }
          await go();
        } catch (e) {
          setError(asError(e, 'Could not record your answer.').message);
        }
      });
    },
    [go, upsertStep, reopenJudged]
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    followRef.current = null;
    setPendingStepId(null);
    setProgress(null);
    const open = stepsRef.current.filter((s) => s.status === 'running' || s.status === 'awaiting_decision');
    // Sections being written are cancelled at the queue; the ones already
    // written are kept — the old message would have been false for them.
    const writing = open.some((s) => actionFor(s.action_key)?.performer === 'sections' || s.action_key === AWAIT_SECTIONS_STEP);
    if (writing) await requestProjectCancel(latest.current.project.id).catch(() => undefined);
    for (const s of open) {
      const output = writing && (actionFor(s.action_key)?.performer === 'sections' || s.action_key === AWAIT_SECTIONS_STEP)
        ? 'Stopped by you. Sections already written were kept; queued sections were cancelled.'
        : 'Stopped by you before it finished. Nothing it would have produced was kept.';
      const closed = await finishAgentStep(s.id, { status: 'cancelled', label: null, output }).catch(() => null);
      if (closed) upsertStep(closed);
    }
    if (runRef.current && !runRef.current.ended_at) await setRunStatus('stopped', 'Stopped by you.').catch(() => undefined);
    setPhase('ended');
  }, [setRunStatus, upsertStep]);

  // --- resume after refresh, and the lease -------------------------------------------

  /** Adopt a live run found on load (or left by a tab that went away). */
  const adopt = useCallback(
    async (found: AgentRun) => {
      // The run this tab's own loop is driving: its step in flight is alive (12 Nov).
      if (drivingHere(found, runRef.current, Boolean(abortRef.current))) return;
      const list = await listAgentSteps(found.id).catch(() => []);
      autoLeftRef.current = await autoWindowsLeft(found).catch(() => 0);
      setAutoPending(autoLeftRef.current > 0);
      setPolicy(found.policy);
      // The selector shows the window this run was given, not the default:
      // after a reload it read "12 steps" beside "3 / 25" (1 Oct, item 21).
      setBudget(found.budget_steps);
      const fresh = found.heartbeat_at && Date.now() - new Date(found.heartbeat_at).getTime() < LEASE_STALE_MS;
      if (found.status === 'running' && fresh && found.lease_holder && found.lease_holder !== tabId.current) {
        // Another tab is driving it. Watch, do not drive.
        commitRun(found);
        commitSteps(list);
        setPhase('watching');
        return;
      }
      // Whatever was mid-flight died with the tab that ran it. Never replay it.
      const repaired: AgentStep[] = [];
      for (const s of list) {
        if (s.status === 'running') {
          repaired.push(
            await finishAgentStep(s.id, {
              status: 'interrupted', label: null,
              output: 'Interrupted: the tab running this step was closed or reloaded before it finished. It was not repeated.',
            }).catch(() => ({ ...s, status: 'interrupted' as const }))
          );
        } else repaired.push(s);
      }
      commitRun(found);
      commitSteps(repaired);
      // The windows this run continues: the planner keeps their history
      // across a reload instead of starting from this window alone.
      setPrior(await listChainSteps(found).catch(() => []));
      // The no-progress guard counts from here, as it does after Resume.
      sinceRef.current = repaired.length;
      fingerprintsRef.current = [];
      performedRef.current = false;
      const waiting = repaired.find((s) => s.status === 'awaiting_decision');
      if (waiting) {
        setPendingStepId(waiting.id);
        setPhase('awaiting');
        return;
      }
      if (found.status === 'running') {
        await updateAgentRun(found.id, { lease_holder: tabId.current, heartbeat_at: new Date().toISOString() });
        void loop();
      } else setPhase('ended');
    },
    [commitRun, commitSteps, loop, setPrior]
  );
  adoptRef.current = adopt;

  const resumed = useRef(false);
  useEffect(() => {
    if (!opts.enabled || resumed.current) return;
    resumed.current = true;
    void (async () => {
      const found = await getLiveAgentRun(opts.project.id);
      if (found) return adopt(found);
      // Nothing live: still show what the last run did — the record should
      // not vanish because the run finished.
      const last = await getLatestAgentRun(opts.project.id);
      if (!last) {
        // No run yet: the panel opens at the level the project's routine setting implies.
        setPolicy((p) => levelFor(opts.project.routine_decisions, p));
        return;
      }
      // Windows authorised in advance outlast a reload (13 Oct).
      autoLeftRef.current = await autoWindowsLeft(last).catch(() => 0);
      setAutoPending(autoLeftRef.current > 0);
      setPolicy(last.policy);
      setBudget(last.budget_steps);
      commitRun(last);
      commitSteps(await listAgentSteps(last.id));
      setPrior(await listChainSteps(last).catch(() => []));
      setPhase('ended');
    })().catch(() => undefined);
  }, [opts.enabled, opts.project.id, adopt, commitRun, commitSteps, setPrior]);

  // Heartbeat while this tab drives a running run; poll while watching another tab.
  useEffect(() => {
    if (phase === 'watching') {
      const t = setInterval(async () => {
        const current = runRef.current;
        if (!current) return;
        const found = await getLiveAgentRun(opts.project.id).catch(() => null);
        commitSteps(await listAgentSteps(current.id).catch(() => stepsRef.current));
        if (!found) {
          commitRun({ ...current, status: 'stopped' });
          setPhase('ended');
          return;
        }
        // The other tab paused, resumed or started the next window: follow
        // that run, so a press here acts on it rather than on a stale copy.
        if (found.id !== current.id || found.status !== 'running') {
          await adopt(found);
          return;
        }
        // The driving tab went away without stopping: take the run over.
        const stale = !found.heartbeat_at || Date.now() - new Date(found.heartbeat_at).getTime() >= LEASE_STALE_MS;
        if (stale) await adopt(found);
      }, 5_000);
      return () => clearInterval(t);
    }
    if (phase !== 'thinking' && phase !== 'performing') return;
    const t = setInterval(async () => {
      const current = runRef.current;
      if (!current) return;
      // Another tab took the run over (this one was throttled in the
      // background): stand down and watch instead of both driving it.
      const found = await getLiveAgentRun(opts.project.id).catch(() => null);
      if (found && found.id === current.id && drivenElsewhere(found, tabId.current)) {
        abortRef.current?.abort();
        abortRef.current = null;
        commitRun(found);
        setPhase('watching');
        return;
      }
      void updateAgentRun(current.id, { heartbeat_at: new Date().toISOString(), lease_holder: tabId.current }).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [phase, opts.project.id, commitRun, commitSteps, adopt]);

  // Unmount: stop driving, but leave the run "running" so reopening resumes it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const active = phase === 'thinking' || phase === 'performing';
  const pendingStep = useMemo(() => steps.find((s) => s.id === pendingStepId) ?? null, [steps, pendingStepId]);
  const pendingStale = useMemo(() => {
    if (!pendingStep) return false;
    // Planned for a stage the project has since left: stale whatever else
    // happened (A5). A proposal to "move to the next stage" from Drafting
    // must not be offered, let alone applied, once the project is in Revision.
    if (pendingStep.stage_id !== opts.state.current_stage_id) return true;
    const latestVersion = opts.bundles[pendingStep.stage_id]?.versions.at(-1);
    return plannedBeforeLatestChange(pendingStep, [latestVersion?.created_at, opts.latestEvaluation?.created_at]);
  }, [pendingStep, opts.state.current_stage_id, opts.bundles, opts.latestEvaluation]);

  // A recorded stop is checked against the project whenever the project
  // changes under it (1 Oct, items 1 and 22). If the user has done what was
  // asked — on the stage itself, not through the card — the request is
  // cleared and the run says so, with Resume beside it.
  const need = run?.needs ?? null;
  const liveRunId = run && !run.ended_at ? run.id : null;
  useEffect(() => {
    if (!need || !liveRunId || pendingStepId || phase === 'thinking' || phase === 'performing' || phase === 'watching') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const o = latest.current;
      if (!o.stage) return;
      try {
        const facts = await readStageFacts({
          project: o.project, template: o.template, stage: o.stage, bundles: o.bundles,
          events: o.loadEvents ? await o.loadEvents() : o.events, latestEvaluation: o.latestEvaluation,
        });
        const current = runRef.current;
        if (cancelled || abortRef.current || !current || current.id !== liveRunId || current.needs !== need) return;
        const hasDraft = stageHasCurrentDraft(o.template, o.state, o.stage.id, o.bundles[o.stage.id]?.versions.at(-1));
        const context = contextWithFacts(o.context, o.stage, facts);
        const holds = needStillHolds(need, {
          state: o.state, stage: o.stage, facts, stageEvaluation: evaluateStage(o.template, o.stage.id, context),
          allowed: allowedActions(o.template, o.state, o.stage, hasDraft, toolsFor(o.project), facts), policy: current.policy,
          outlineStageId: outlineStageFor(o.template)?.id ?? null, largeJobAcknowledged: largeJobOkRef.current,
          objective: o.project.objective, currentStageId: o.state.current_stage_id,
        });
        if (holds) return;
        const note = need.onStage && need.onStage !== o.state.current_stage_id ? NEED_MOVED_ON : NEED_CLEARED;
        await updateAgentRun(current.id, { needs: null, stop_reason: note });
        if (runRef.current?.id === current.id) commitRun({ ...runRef.current, needs: null, stop_reason: note });
      } catch {
        // Could not read: leave the request as it stands; the next change retries.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [need, liveRunId, pendingStepId, phase, opts.state, opts.bundles, opts.context, opts.project.objective, commitRun]);

  /**
   * Close an outdated proposal and ask the planner again about the stage as it
   * is now. The old step is cancelled, not declined: the user did not reject
   * the move, the project moved on under it.
   */
  const replan = useCallback(async () => {
    const id = pendingStepId;
    if (!id || abortRef.current) return;
    setPendingStepId(null);
    setError(null);
    try {
      const closed = await finishAgentStep(id, { status: 'cancelled', label: null, output: 'Superseded: the stage changed after this was suggested.' });
      upsertStep(closed);
      await setRunStatus('stopped', 'Suggested again after the stage changed.');
      setPhase('ended');
      setPolicy('guided');
      await startRun('guided', null);
    } catch (e) {
      setError(asError(e, 'Could not suggest a move.').message);
    }
  }, [pendingStepId, setRunStatus, upsertStep, startRun]);

  /** FR-18: the user confirmed a large drafting run; resume and let it through once. */
  const acknowledgeLargeJob = useCallback(async (sections: number) => {
    largeJobOkRef.current = sections;
    await go();
  }, [go]);

  return {
    progress,
    calls: calls === null ? null : { used: calls, cap: MAX_MODEL_CALLS_PER_CHAIN },
    needs: run?.needs ?? null,
    continueRun,
    acknowledgeLargeJob,
    stageLabelFor,
    stepLabel,
    stepEffect,
    autoWindows, setAutoWindows, autoPending,
    policy, setPolicy, budget, setBudget, run, steps, priorSteps, phase, active, pendingStep, pendingStale, authorizing, error,
    go, update, applyAndContinue, suggest, replan, stop, approve, decline, answer, fixObjective, retryRepair, checkAnswer,
    handsOff,
    dismissError: useCallback(() => setError(null), []),
  };
}

/**
 * How many of a stage's tries to set aside so exactly one more is allowed. A count
 * per press wasn't enough once a stage had used more than its two (9 Nov, production:
 * after three tries and a reload, "Try once more" came straight back without trying).
 */
export function extraTriesForOneMore(tried: readonly string[], stageId: string, granted = 0): number {
  return Math.max(granted, tried.filter((id) => id === stageId).length - REPAIR_TRIES + 1);
}

/** The repairs tried, less one per extra try the user granted for a stage. */
export function withExtraTries(tried: readonly string[], extra: ReadonlyMap<string, number>): string[] {
  const left = new Map(extra);
  return tried.filter((id) => {
    const n = left.get(id) ?? 0;
    if (n > 0) {
      left.set(id, n - 1);
      return false;
    }
    return true;
  });
}
