'use client';

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

import { setUsageOperation, takeStepCost } from '@/lib/supabase/model-usage';
import { RefusedRevision } from '@/lib/workflow/commit-check';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { actionFor, actionLabel, AWAIT_SECTIONS_STEP, INTERPRET_STEP, USER_ANSWER_STEP } from '@/lib/agent/actions';
import { contextWithFacts, readOutcomeProof, readStageFacts, type StageFacts } from '@/lib/agent/facts';
import { stageDrafts } from '@/lib/workflow/stage-artifact';
import { delegableToCommit, policyConfirmable, staleRepair, describeNeed, NEED_CLEARED, NEED_MOVED_ON, needStillHolds, needsUser, requiredWork, type NeedsUser } from '@/lib/agent/needs';
import { assertHonestOutcome, verifyOutcome } from '@/lib/agent/outcome';
import { outlineStageFor } from '@/lib/outline/actions';
import { listRecommendations, recordDecision } from '@/lib/supabase/recommendations';
import { projectMemory } from '@/lib/agent/memory';
import { requestProjectCancel } from '@/lib/supabase/jobs';
import { recordFacts } from '@/lib/supabase/facts';
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
import { answerAsFact } from '@/lib/workflow/answers';
import { authorizeRun } from '@/lib/agent/authorize';
import { buildAgentState } from '@/lib/agent/digest';
import { performStep, type PerformContext, type StepOutcome } from '@/lib/agent/perform';
import { allowedActions, stageHasCurrentDraft, LIVE_TOOLS, polishSinceDirection, unsavedDerivation, withoutRepeatReasoning, withoutEndlessPolish, withoutSettledRuns, withoutOverride, DEFAULT_BUDGET_STEPS, fitsBudget, noChange, plannedBeforeLatestChange, preempt, shouldPause, stateFingerprint, stepCost } from '@/lib/agent/policy';
import {
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
import { evaluateStage, getStage } from '@/lib/workflow/engine';
import { documentsAwaitingFacts } from '@/lib/workflow/facts';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { StageContext, StageDefinition, StageEvaluation, WorkflowEvent, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { NewEvaluation, NewVersion } from '@/lib/supabase/versions';
import type { AgentRun, AgentRunStatus, AgentStep, ExecutionPolicy } from '@/types/agent';
import type { OutlineSection } from '@/types';
import type { Evaluation, Project } from '@/types/project';

export const HEARTBEAT_MS = 10_000;
/** A heartbeat older than this means the tab that held the lease is gone. */
export const LEASE_STALE_MS = 25_000;

export type GoPhase = 'idle' | 'thinking' | 'performing' | 'awaiting' | 'ended' | 'watching';

interface Options {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  stage: StageDefinition | undefined;
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
  commitCriterion?: (stageId: string, criterionId: string) => Promise<void>;
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
  const answer = after.findIndex((s) => s.action_key === USER_ANSWER_STEP);
  if (answer < 0) return undefined;
  const revisedSince = after.slice(answer + 1).some(
    (s) => ['revise', 'apply'].includes(actionFor(s.action_key)?.performer ?? '') && s.status === 'succeeded'
  );
  return revisedSince ? undefined : after[answer].output.trim() || undefined;
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

export function useGoLoop(opts: Options) {
  const [policy, setPolicy] = useState<ExecutionPolicy>('guided');
  const [budget, setBudget] = useState(DEFAULT_BUDGET_STEPS);
  /** Further windows an Autonomous run may start on its own (chosen in the authorization). */
  const [autoWindows, setAutoWindows] = useState(0);
  const autoLeftRef = useRef(0);
  // Whether a used-up window will be followed by another without asking.
  // State, not the ref, so the "window used up" card is not shown for the
  // moment between one window ending and the next starting.
  const [autoPending, setAutoPending] = useState(false);
  const continueRef = useRef<(auto?: boolean) => Promise<void>>(async () => {});
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [phase, setPhase] = useState<GoPhase>('idle');
  const [pendingStepId, setPendingStepId] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState<Exclude<ExecutionPolicy, 'guided'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(opts);
  latest.current = opts;
  const runRef = useRef<AgentRun | null>(null);
  const stepsRef = useRef<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const followRef = useRef<StepOutcome['followUp'] | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  /** Steps of the windows this run continues (B4): the planner reads them as history. */
  const priorStepsRef = useRef<AgentStep[]>([]);
  /** The user said "draft them anyway" for this many sections (FR-18). */
  const largeJobOkRef = useRef<number | null>(null);
  /**
   * Steps before this index predate the last Go/Resume. The no-progress and
   * repeated-failure guards only count what happened since: pressing Resume
   * after "chosen 3 times without moving on" is the user's direction to carry
   * on, and re-reading the same three steps made it an instant dead end.
   */
  const sinceRef = useRef(0);
  /**
   * What the project was after each performed move since the last Go/Resume
   * (`stateFingerprint`). Three in a row the same is a run going round in
   * circles (2 Oct, screenshot 7), whatever the moves were called.
   */
  const fingerprintsRef = useRef<string[]>([]);
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
      if (needs) needs = { ...needs, onStage: latest.current.state.current_stage_id };
      const terminal = ['completed', 'budget_exhausted', 'stopped', 'failed'].includes(status);
      if (terminal) await endAgentRun(current.id, status, reason ?? '', needs);
      else await updateAgentRun(current.id, { status, stop_reason: reason, needs });
      commitRun({ ...current, status, stop_reason: reason, needs, ended_at: terminal ? new Date().toISOString() : null });
    },
    [commitRun]
  );
  const stageLabelFor = useCallback((id: string) => getStage(latest.current.template, id)?.short_label ?? id, []);

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
          context, approvedOutline: o.approvedOutline, facts, dataFiles: dataFileBriefs(o.project), tools: LIVE_TOOLS, memory, controls: o.getControls?.() ?? undefined,
        }),
        approvedByUser, deliverableDone: o.deliverableDone,
        interpret: interpret
          ? { sandboxRunId: interpret.sandboxRunId, code: interpret.code, stdout: interpret.stdout, stderr: interpret.stderr, exitCode: interpret.exitCode }
          : undefined,
        appendStageVersion: o.appendStageVersion, recordStageEvaluation: o.recordStageEvaluation,
        setStageSummary: o.setStageSummary, setStageFigures: o.setStageFigures, afterStageEvent: o.reloadEvents, commitCriterion: o.commitCriterion, signal,
        facts, latestEvaluation: o.latestEvaluation, refresh: o.onRefresh, onProgress: setProgress,
        conflictAnswer: answerToConflict(stepsRef.current, o.stage.id),
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
        outcome = {
          status: 'failed', label: null, toolsUsed: [], changes: {},
          // A refused revision tells the next plan what a retry must do; a
          // second failure in a row stops the run (MAX_CONSECUTIVE_FAILURES).
          output: e instanceof RefusedRevision
            ? `${e.message}. A retry must start from the current version and keep every row the user decided.`
            : e instanceof Error && e.message ? e.message : 'The step failed.',
        };
      }
      if (signal.aborted) throw new Stopped();

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
      const finished = await finishAgentStep(step.id, {
        status: outcome.status, label: outcome.label, output: outcome.output, blockKind: outcome.blockKind ?? null,
        toolsUsed: outcome.toolsUsed, changes: outcome.changes, params: outcome.params,
        costUsd: takeStepCost(step.id),
      });
      upsertStep(finished);
      setProgress(null);
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
        await setRunStatus('awaiting_decision', outcome.output.split('\n')[0], outcome.needs ?? null);
        return 'stop';
      }
      if (outcome.stop) {
        await setRunStatus(outcome.stop.status, outcome.stop.reason, outcome.needs ?? null);
        return 'stop';
      }
      if (outcome.status === 'blocked') {
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
    try {
      for (;;) {
        if (signal.aborted) throw new Stopped();
        const o = latest.current;
        const current = runRef.current!;
        if (!o.stage) throw new Error(NO_STAGE);

        // The second half of run_computation is not a choice: interpret what ran.
        if (followRef.current) {
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: o.stage.id, mode: o.project.mode, actionKey: INTERPRET_STEP,
            params: { sandbox_run_id: followRef.current.sandboxRunId },
            rationale: 'Code ran; reading what it actually printed.', expectedOutcome: 'What the output shows.',
            needsDecision: false, decisionQuestion: null,
          });
          upsertStep(step);
          if ((await perform(step, false, signal)) === 'stop') break;
          continue;
        }

        const stop = preempt({
          state: o.state, objective: o.project.objective, stepsUsed: current.steps_used,
          budgetSteps: current.budget_steps,
          steps: stepsRef.current.slice(sinceRef.current).filter((s) => s.action_key !== AWAIT_SECTIONS_STEP),
        });
        if (stop) {
          // Said as what the user can do about it (B4), not only why it stopped.
          const blocked = o.state.stages[o.stage.id]?.blocked;
          const need: NeedsUser | null =
            stop.status === 'budget_exhausted' ? { kind: 'continue_budget', budgetSteps: current.budget_steps }
            : stop.status === 'blocked' && blocked ? { kind: 'unblock_stage', stageId: o.stage.id, reason: blocked.reason, blockKind: blocked.kind }
            : stop.status === 'awaiting_decision' && !o.project.objective.trim() ? { kind: 'set_objective' }
            : null;
          await setRunStatus(stop.status, stop.reason, need);
          break;
        }

        setPhase('thinking');
        const freshEvents = o.loadEvents ? await o.loadEvents() : o.events;
        const facts: StageFacts = await readStageFacts({
          project: o.project, template: o.template, stage: o.stage, bundles: o.bundles,
          events: freshEvents, latestEvaluation: o.latestEvaluation,
        });
        if (signal.aborted) throw new Stopped();
        // What the project has already decided, from its own records (1 Oct, item 20).
        const memory = await readMemory(o, [...priorStepsRef.current, ...stepsRef.current]);

        // Sections already being written — after a reload, or started by the
        // user — are waited for first, without a planner call or a step.
        if (facts.manuscript?.pendingJobs.length) {
          const step = await startAgentStep({
            runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
            stageId: o.stage.id, mode: o.project.mode, actionKey: AWAIT_SECTIONS_STEP, params: {},
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

        // After a performed move, what the project is now. Three moves that
        // left it exactly as it was is a run going round in circles — the
        // client's log of repeated "Check this stage" / "Apply the findings"
        // (2 Oct, screenshot 7) — and stops here, before another model call.
        if (performedRef.current) {
          performedRef.current = false;
          fingerprintsRef.current.push(stateFingerprint({ state: o.state, bundles: o.bundles, events: freshEvents, facts, stageEvaluation }));
          const circling = noChange(fingerprintsRef.current);
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
            allowedActions(o.template, o.state, o.stage, hasDraft, LIVE_TOOLS, facts), stageEvaluation.canAdvance, current.policy
            // Asked once: if the user stayed, the stage is to be done.
          ).filter((k) => (k !== 'propose_skip' || !proposedSkipHere) && (k !== 'propose_statuses' || !proposedStatusesHere)),
          polishedHere,
          stageEvaluation.canAdvance
        ), facts.review);
        // C4: a derivation not yet saved is saved next, not derived again.
        const allSteps = [...priorStepsRef.current, ...stepsRef.current];
        allowed.splice(0, allowed.length, ...withoutRepeatReasoning(allowed, allSteps, o.stage!.id));

        // Runs the data could carry out are tried before the table is handed
        // to the user: at most once per row, so a row no code can settle
        // still ends with the user.
        const runsTried = [...priorStepsRef.current, ...stepsRef.current].filter(
          (s) => s.action_key === 'run_computation' && s.stage_id === o.stage!.id
        ).length;
        const runAttemptsLeft =
          facts.review?.schema.execution && allowed.includes('run_computation') && dataFileBriefs(o.project).length
            ? Math.max(0, facts.review.items.length - runsTried)
            : 0;

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
        // 6 Oct: proposals that stand are Go's to confirm under "handle them for me".
        if (policyConfirmable(o.stage, facts, routine) > 0) allowed.push('confirm_proposals');
        // 7 Oct (L-51): attached documents whose facts are not on record yet,
        // read once per run under "handle them for me".
        const factsTried = [...priorStepsRef.current, ...stepsRef.current].some((s) => s.action_key === 'extract_facts');
        if (routine === 'handle' && !factsTried && documentsAwaitingFacts(o.project)) allowed.push('extract_facts');

        // 6 Oct: a stage a change reopened is repaired before anything else —
        // on whichever stage it is — so Summary is not left recommending A.
        // At most twice per stage (REPAIR_TRIES): one that still cannot close is the user's.
        const recheckTried = [...priorStepsRef.current, ...stepsRef.current]
          .filter((s) => s.action_key === 'recheck_stage')
          .map((s) => String(s.params?.stage_id ?? ''));
        const repair = staleRepair(o.template, o.state, recheckTried);
        if (repair) allowed.push('recheck_stage');

        // Before the planner is asked: is the next move the user's? (B4)
        const need = repair ? null : needsUser({
          state: o.state, stage: o.stage, facts, stageEvaluation, allowed, policy: current.policy,
          outlineStageId: outlineStageFor(o.template)?.id ?? null, largeJobAcknowledged: largeJobOkRef.current,
          runAttemptsLeft, lookupDue, routine, commitTried,
        });
        if (need) {
          await setRunStatus('awaiting_decision', describeNeed(need, stageLabelFor).message, need);
          break;
        }

        // What the stage itself still requires comes before anything the
        // planner might prefer (4 Oct): a cut-off draft is finished, and at an
        // approval the findings are applied and the work checked first.
        const loops = o.template.stages.some((s) => s.transitions.loop_to);
        const required = repair ?? requiredWork({
          stage: o.stage, facts, stageEvaluation, allowed, lookupDue, routine, commitTried,
          ...(loops ? { round: { staleDraft: stageDrafts(o.stage) && !hasDraft } } : {}),
        });
        const choice = required
          ? {
              action_key: required.key, params: required.params ?? {}, rationale: required.rationale, expected_outcome: required.expected,
              needs_user_decision: false, decision_question: null,
            }
          : await api.agentNextAction(
              {
                inputs: inputsFrom(o.project),
                state: buildAgentState({
                  template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
                  stageEvaluation, latestEvaluation: o.latestEvaluation, steps: [...priorStepsRef.current, ...stepsRef.current],
                  context, approvedOutline: o.approvedOutline, facts, dataFiles: dataFileBriefs(o.project), tools: LIVE_TOOLS, memory, controls: o.getControls?.() ?? undefined,
                }),
                allowed_actions: allowed, policy: current.policy, model: o.project.model,
              },
              signal
            );
        if (signal.aborted) throw new Stopped();
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
          stageId: o.stage.id, mode: o.project.mode, actionKey: choice.action_key, params: choice.params ?? {},
          rationale: choice.rationale, expectedOutcome: choice.expected_outcome,
          needsDecision: choice.needs_user_decision, decisionQuestion: choice.decision_question,
        });
        upsertStep(step);

        // A question, or a suggestion to skip, is itself the pause.
        const asking = ['ask', 'skip'].includes(actionFor(choice.action_key)?.performer ?? '');
        if (!asking && shouldPause(current.policy, choice.action_key, choice.needs_user_decision)) {
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
      if (ended?.status === 'budget_exhausted' && ended.policy === 'autonomous' && autoLeftRef.current > 0) {
        autoLeftRef.current -= 1;
        void continueRef.current(true).finally(() => setAutoPending(autoLeftRef.current > 0));
      }
    } catch (e) {
      if (e instanceof Stopped || signal.aborted) return;
      const message = e instanceof Error && e.message ? e.message : 'Go mode hit an error.';
      setError(message);
      // A step whose close-out was refused (e.g. the database rejected a
      // label) must not sit "in progress" forever.
      for (const s of stepsRef.current.filter((x) => x.status === 'running')) {
        const closed = await finishAgentStep(s.id, { status: 'failed', label: null, output: `Could not record this step: ${message}` }).catch(() => null);
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
      const created = await createAgentRun({
        projectId: o.project.id, userId: o.project.user_id, policy: chosen,
        authorizationId, budgetSteps: budget, leaseHolder: tabId.current,
      });
      commitRun(created);
      commitSteps([]);
      priorStepsRef.current = carried;
      largeJobOkRef.current = null;
      followRef.current = null;
      sinceRef.current = 0;
      fingerprintsRef.current = [];
      performedRef.current = false;
      autoLeftRef.current = chosen === 'autonomous' ? autoWindows : 0;
      setAutoPending(autoLeftRef.current > 0);
      void loop();
    },
    [budget, autoWindows, commitRun, commitSteps, loop]
  );

  /**
   * Another window (B4, Sean item 3): the same policy under the same
   * authorization, chained to the run whose window was used up, with that
   * run's steps kept as history for the planner. Each window is the user's
   * click; when the policy needed an authorization, the click is recorded
   * against it.
   */
  const continueRun = useCallback(async (auto = false) => {
    const o = latest.current;
    const prev = runRef.current;
    if (!prev || prev.status !== 'budget_exhausted') {
      setError('There is no used-up window to continue. Press Go to start one.');
      return;
    }
    setError(null);
    try {
      const created = await createAgentRun({
        projectId: o.project.id, userId: o.project.user_id, policy: prev.policy,
        authorizationId: prev.authorization_id, budgetSteps: prev.budget_steps, leaseHolder: tabId.current,
        continuesRunId: prev.id, autoContinued: auto,
      });
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
      priorStepsRef.current = [...priorStepsRef.current, ...stepsRef.current];
      setPolicy(prev.policy);
      setBudget(prev.budget_steps);
      commitRun(created);
      commitSteps([]);
      followRef.current = null;
      sinceRef.current = 0;
      fingerprintsRef.current = [];
      performedRef.current = false;
      void loop();
    } catch (e) {
      // A window the loop tried to start itself and the database refused is
      // not an error to show: the used-up window's own card asks for the click.
      if (auto) autoLeftRef.current = 0;
      else setError(e instanceof Error ? e.message : 'Could not continue Go mode.');
    }
  }, [commitRun, commitSteps, loop]);
  continueRef.current = continueRun;

  const go = useCallback(async () => {
    setError(null);
    const live = runRef.current;
    try {
      // Resume a paused run of the same policy rather than starting over:
      // it keeps its budget and its history.
      if (live && !live.ended_at && live.policy === policy && (live.status === 'blocked' || live.status === 'awaiting_decision') && !pendingStepId) {
        sinceRef.current = stepsRef.current.length;
        fingerprintsRef.current = [];
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
      else setAuthorizing(policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Go mode.');
    }
  }, [policy, budget, pendingStepId, commitRun, loop, startRun, continueRun]);

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
      setError(e instanceof Error ? e.message : 'Could not suggest a move.');
    }
  }, [pendingStepId, startRun]);

  const confirmAuthorization = useCallback(async () => {
    const chosen = authorizing;
    const o = latest.current;
    if (!chosen || !o.stage) return;
    try {
      const authId = await authorizeRun({
        projectId: o.project.id, userId: o.project.user_id, policy: chosen, budgetSteps: budget, stageId: o.stage.id,
        autoContinueWindows: chosen === 'autonomous' ? autoWindows : 0,
      });
      setAuthorizing(null);
      await startRun(chosen, authId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not authorize Go mode.');
    }
  }, [authorizing, budget, autoWindows, startRun]);

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
    try {
      await setAgentStepStatus(step.id, 'running');
      await setRunStatus('running', null);
      upsertStep({ ...step, status: 'running' });
      if ((await perform({ ...step, status: 'running' }, true, controller.signal)) === 'stop') {
        setPhase('ended');
        return;
      }
      void loop();
    } catch (e) {
      if (e instanceof Stopped) return;
      setError(e instanceof Error ? e.message : 'That step failed.');
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
  const answer = useCallback(
    async (text: string) => {
      const current = runRef.current;
      const o = latest.current;
      if (!current || !o.stage || !text.trim()) return;
      try {
        const step = await startAgentStep({
          runId: current.id, userId: o.project.user_id, projectId: o.project.id, idx: stepsRef.current.length,
          stageId: o.stage.id, mode: o.project.mode, actionKey: USER_ANSWER_STEP, params: {},
          rationale: '', expectedOutcome: '', needsDecision: false, decisionQuestion: null,
        });
        upsertStep(await finishAgentStep(step.id, { status: 'succeeded', label: null, output: text.trim() }));
        // The answer is a decision of record, not only a line in this run
        // (Sean, 7 Oct, emails 8 and 11): evaluation, the final review and the
        // objective check read the project's facts, never the run's steps.
        const asked = current.needs?.kind === 'answer_question' ? current.needs.question : current.stop_reason ?? '';
        const fact = answerAsFact(asked, text, { run_id: current.id, step_id: step.id, stage_id: o.stage.id });
        if (fact) await recordFacts(o.project, [fact]);
        // A stage stuck on that decision is no longer stuck.
        const st = o.state.stages[o.stage.id];
        if (st?.status === 'blocked' && st.blocked?.kind === 'needs_decision') {
          await appendWorkflowEvent(o.project.id, o.project.user_id, {
            type: 'stage_unblocked', stage_id: o.stage.id, actor: 'user', reason: `Answered: ${text.trim().slice(0, 300)}`,
          });
        }
        if (fact || st?.status === 'blocked') {
          await Promise.all([o.onRefresh?.(), o.reloadEvents()]);
        }
        await go();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not record your answer.');
      }
    },
    [go, upsertStep]
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
      const list = await listAgentSteps(found.id).catch(() => []);
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
      priorStepsRef.current = await listChainSteps(found).catch(() => []);
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
    [commitRun, commitSteps, loop]
  );

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
      if (!last) return;
      setPolicy(last.policy);
      setBudget(last.budget_steps);
      commitRun(last);
      commitSteps(await listAgentSteps(last.id));
      priorStepsRef.current = await listChainSteps(last).catch(() => []);
      setPhase('ended');
    })().catch(() => undefined);
  }, [opts.enabled, opts.project.id, adopt, commitRun, commitSteps]);

  // Heartbeat while this tab drives a running run; poll while watching another tab.
  useEffect(() => {
    if (phase === 'watching') {
      const t = setInterval(async () => {
        const current = runRef.current;
        if (!current) return;
        const found = await getLiveAgentRun(opts.project.id).catch(() => null);
        commitSteps(await listAgentSteps(current.id).catch(() => stepsRef.current));
        if (!found || found.id !== current.id || found.status !== 'running') {
          commitRun(found ?? { ...current, status: 'stopped' });
          setPhase('ended');
          return;
        }
        // The driving tab went away without stopping: take the run over.
        const stale = !found.heartbeat_at || Date.now() - new Date(found.heartbeat_at).getTime() >= LEASE_STALE_MS;
        if (stale) await adopt(found);
      }, 5_000);
      return () => clearInterval(t);
    }
    if (phase !== 'thinking' && phase !== 'performing') return;
    const t = setInterval(() => {
      const current = runRef.current;
      if (current) void updateAgentRun(current.id, { heartbeat_at: new Date().toISOString(), lease_holder: tabId.current }).catch(() => undefined);
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
          allowed: allowedActions(o.template, o.state, o.stage, hasDraft, LIVE_TOOLS, facts), policy: current.policy,
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
      setError(e instanceof Error ? e.message : 'Could not suggest a move.');
    }
  }, [pendingStepId, setRunStatus, upsertStep, startRun]);

  /** FR-18: the user confirmed a large drafting run; resume and let it through once. */
  const acknowledgeLargeJob = useCallback(async (sections: number) => {
    largeJobOkRef.current = sections;
    await go();
  }, [go]);

  return {
    progress,
    needs: run?.needs ?? null,
    continueRun,
    acknowledgeLargeJob,
    stageLabelFor,
    autoWindows, setAutoWindows, autoPending,
    policy, setPolicy, budget, setBudget, run, steps, phase, active, pendingStep, pendingStale, authorizing, error,
    go, suggest, replan, stop, approve, decline, answer, confirmAuthorization,
    cancelAuthorization: useCallback(() => setAuthorizing(null), []),
    dismissError: useCallback(() => setError(null), []),
  };
}
