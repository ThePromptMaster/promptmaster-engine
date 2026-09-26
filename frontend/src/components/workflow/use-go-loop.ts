'use client';

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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import { actionFor, actionLabel, INTERPRET_STEP, USER_ANSWER_STEP } from '@/lib/agent/actions';
import { authorizeRun } from '@/lib/agent/authorize';
import { buildAgentState } from '@/lib/agent/digest';
import { performStep, type PerformContext, type StepOutcome } from '@/lib/agent/perform';
import { allowedActions, DEFAULT_BUDGET_STEPS, fitsBudget, preempt, shouldPause, stepCost } from '@/lib/agent/policy';
import {
  createAgentRun,
  endAgentRun,
  finishAgentStep,
  getLatestAgentRun,
  getLiveAgentRun,
  listAgentSteps,
  setAgentStepStatus,
  startAgentStep,
  updateAgentRun,
} from '@/lib/supabase/agent';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { StageContext, StageDefinition, StageEvaluation, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
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
  /** Re-read the event log after a stage event; resolves once the page has it. */
  reloadEvents: () => Promise<void>;
}

class Stopped extends Error {}

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
  /**
   * Steps before this index predate the last Go/Resume. The no-progress and
   * repeated-failure guards only count what happened since: pressing Resume
   * after "chosen 3 times without moving on" is the user's direction to carry
   * on, and re-reading the same three steps made it an instant dead end.
   */
  const sinceRef = useRef(0);
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
    async (status: AgentRunStatus, reason: string | null) => {
      const current = runRef.current;
      if (!current) return;
      const terminal = ['completed', 'budget_exhausted', 'stopped', 'failed'].includes(status);
      if (terminal) await endAgentRun(current.id, status, reason ?? '');
      else await updateAgentRun(current.id, { status, stop_reason: reason });
      commitRun({ ...current, status, stop_reason: reason, ended_at: terminal ? new Date().toISOString() : null });
    },
    [commitRun]
  );

  // --- performing one step ------------------------------------------------------

  const perform = useCallback(
    async (step: AgentStep, approvedByUser: boolean, signal: AbortSignal): Promise<'continue' | 'stop'> => {
      const o = latest.current;
      const current = runRef.current!;
      if (!o.stage) throw new Stopped();
      setPhase('performing');

      const interpret = step.action_key === INTERPRET_STEP ? followRef.current ?? undefined : undefined;
      followRef.current = null;

      const ctx: PerformContext = {
        project: o.project, template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
        context: o.context, approvedOutline: o.approvedOutline, run: current, step,
        digest: buildAgentState({
          template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
          stageEvaluation: o.stageEvaluation, latestEvaluation: o.latestEvaluation, steps: stepsRef.current,
        }),
        approvedByUser, deliverableDone: o.deliverableDone,
        interpret: interpret
          ? { sandboxRunId: interpret.sandboxRunId, code: interpret.code, stdout: interpret.stdout, stderr: interpret.stderr, exitCode: interpret.exitCode }
          : undefined,
        appendStageVersion: o.appendStageVersion, recordStageEvaluation: o.recordStageEvaluation,
        setStageSummary: o.setStageSummary, afterStageEvent: o.reloadEvents, signal,
      };

      let outcome: StepOutcome;
      try {
        outcome = await performStep(ctx);
      } catch (e) {
        if (signal.aborted || (e as Error)?.name === 'AbortError') throw new Stopped();
        outcome = {
          status: 'failed', label: null, toolsUsed: [], changes: {},
          output: e instanceof Error && e.message ? e.message : 'The step failed.',
        };
      }
      if (signal.aborted) throw new Stopped();

      const finished = await finishAgentStep(step.id, {
        status: outcome.status, label: outcome.label, output: outcome.output, blockKind: outcome.blockKind ?? null,
        toolsUsed: outcome.toolsUsed, changes: outcome.changes, params: outcome.params,
      });
      upsertStep(finished);
      const used = (runRef.current?.steps_used ?? 0) + 1;
      await updateAgentRun(current.id, { steps_used: used, heartbeat_at: new Date().toISOString() });
      commitRun({ ...runRef.current!, steps_used: used });

      if (outcome.followUp) followRef.current = outcome.followUp;
      if (outcome.stop) {
        await setRunStatus(outcome.stop.status, outcome.stop.reason);
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
        if (!o.stage) throw new Stopped();

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
          budgetSteps: current.budget_steps, steps: stepsRef.current.slice(sinceRef.current),
        });
        if (stop) {
          await setRunStatus(stop.status, stop.reason);
          break;
        }

        setPhase('thinking');
        const hasDraft = (o.bundles[o.stage.id]?.versions.at(-1)?.content ?? '').trim().length > 0;
        const allowed = allowedActions(o.template, o.state, o.stage, hasDraft);
        const digest = buildAgentState({
          template: o.template, state: o.state, stage: o.stage, bundles: o.bundles,
          stageEvaluation: o.stageEvaluation, latestEvaluation: o.latestEvaluation, steps: stepsRef.current,
        });
        const choice = await api.agentNextAction(
          { inputs: inputsFrom(o.project), state: digest, allowed_actions: allowed, policy: current.policy, model: o.project.model },
          signal
        );
        if (signal.aborted) throw new Stopped();
        if (!fitsBudget(choice.action_key, current.steps_used, current.budget_steps)) {
          await setRunStatus(
            'budget_exhausted',
            `Stopped before "${actionLabel(choice.action_key)}": it needs ${stepCost(choice.action_key)} steps and ${current.budget_steps - current.steps_used} remain.`
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

        const asking = actionFor(choice.action_key)?.performer === 'ask';
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
  }, [perform, setRunStatus, upsertStep]);

  // --- controls -----------------------------------------------------------------

  const startRun = useCallback(
    async (chosen: ExecutionPolicy, authorizationId: string | null) => {
      const o = latest.current;
      const live = runRef.current;
      if (live && !live.ended_at && live.status !== 'running') {
        await endAgentRun(live.id, 'stopped', 'Superseded by a new Go.');
      }
      const created = await createAgentRun({
        projectId: o.project.id, userId: o.project.user_id, policy: chosen,
        authorizationId, budgetSteps: budget, leaseHolder: tabId.current,
      });
      commitRun(created);
      commitSteps([]);
      followRef.current = null;
      sinceRef.current = 0;
      void loop();
    },
    [budget, commitRun, commitSteps, loop]
  );

  const go = useCallback(async () => {
    setError(null);
    const live = runRef.current;
    try {
      // Resume a paused run of the same policy rather than starting over:
      // it keeps its budget and its history.
      if (live && !live.ended_at && live.policy === policy && (live.status === 'blocked' || live.status === 'awaiting_decision') && !pendingStepId) {
        sinceRef.current = stepsRef.current.length;
        await updateAgentRun(live.id, { status: 'running', stop_reason: null, lease_holder: tabId.current, heartbeat_at: new Date().toISOString() });
        commitRun({ ...live, status: 'running', stop_reason: null });
        void loop();
        return;
      }
      if (policy === 'guided') await startRun('guided', null);
      else setAuthorizing(policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Go mode.');
    }
  }, [policy, pendingStepId, commitRun, loop, startRun]);

  const confirmAuthorization = useCallback(async () => {
    const chosen = authorizing;
    const o = latest.current;
    if (!chosen || !o.stage) return;
    try {
      const authId = await authorizeRun({
        projectId: o.project.id, userId: o.project.user_id, policy: chosen, budgetSteps: budget, stageId: o.stage.id,
      });
      setAuthorizing(null);
      await startRun(chosen, authId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not authorize Go mode.');
    }
  }, [authorizing, budget, startRun]);

  const approve = useCallback(async () => {
    const id = pendingStepId;
    const step = stepsRef.current.find((s) => s.id === id);
    const current = runRef.current;
    if (!step || !current) return;
    setPendingStepId(null);
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
    const open = stepsRef.current.filter((s) => s.status === 'running' || s.status === 'awaiting_decision');
    for (const s of open) {
      const closed = await finishAgentStep(s.id, { status: 'cancelled', label: null, output: 'Stopped by you before it finished. Nothing it would have produced was kept.' }).catch(() => null);
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
      commitRun(last);
      commitSteps(await listAgentSteps(last.id));
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

  return {
    policy, setPolicy, budget, setBudget, run, steps, phase, active, pendingStep, authorizing, error,
    go, stop, approve, decline, answer, confirmAuthorization,
    cancelAuthorization: useCallback(() => setAuthorizing(null), []),
    dismissError: useCallback(() => setError(null), []),
  };
}
