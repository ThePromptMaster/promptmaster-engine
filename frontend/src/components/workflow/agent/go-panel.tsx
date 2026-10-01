'use client';

import { useState } from 'react';

import { actionLabel } from '@/lib/agent/actions';
import { describeNeed, isClearedNote } from '@/lib/agent/needs';
import type { useGoLoop } from '../use-go-loop';
import { AuthorizationDialog } from './authorization-dialog';
import { DecisionPrompt, QuestionPrompt } from './decision-prompt';
import { GoControl } from './go-control';
import { NeedsYouCard } from './needs-you-card';
import { PolicySelector } from './policy-selector';
import { StepTimeline } from './step-timeline';
import { TransparencyPanel } from './transparency-panel';

/**
 * Go mode (PM-17 … PM-20): the four layers side by side — the stage (where),
 * the mode (how to think), the action (what now) and the execution policy (how
 * autonomously) — with what is actually happening underneath.
 */
/** What the workspace can do on the run's behalf when it needs the user (B4). */
export interface NeedsActions {
  approveOutline: (stageId: string) => Promise<void>;
  unblock: () => Promise<void>;
  tick: (criterionId: string) => Promise<void>;
}

export function GoPanel({
  go,
  stageLabel,
  mode,
  needsActions,
}: {
  go: ReturnType<typeof useGoLoop>;
  stageLabel: string;
  mode: string;
  needsActions?: NeedsActions;
}) {
  const [open, setOpen] = useState(false);
  const live = go.run && !go.run.ended_at;
  const expanded = open || Boolean(live) || go.steps.length > 0 || Boolean(go.authorizing);
  const current = go.steps.at(-1) ?? null;
  const next = go.pendingStep
    ? `${actionLabel(go.pendingStep.action_key)} — waiting for your approval`
    : go.phase === 'thinking' || go.phase === 'performing'
      ? 'Chosen after this step finishes'
      : go.run?.status === 'completed'
        ? 'Nothing — the objective is met'
        : 'Press Go to choose the next move';
  const askingUser = Boolean(live && go.run!.status === 'awaiting_decision' && !go.pendingStep && !go.active);
  const canResume = Boolean(live && (go.run!.status === 'blocked' || go.run!.status === 'awaiting_decision') && !go.pendingStep);
  // The "I need you to…" card (B4): shown for a stop the user can clear, live
  // or used-up. A question keeps its own prompt.
  const need = !go.active && !go.pendingStep && go.run?.needs && go.run.needs.kind !== 'answer_question' && (live || go.run.status === 'budget_exhausted')
    ? go.run.needs
    : null;
  // The status panel below already says so; this only keeps it from being asked as a question.
  const cleared = canResume && !need && isClearedNote(go.run?.stop_reason);
  const canContinue = Boolean(
    go.run && go.run.status === 'budget_exhausted' && go.run.policy === go.policy && go.run.budget_steps === go.budget
  );
  const act = async () => {
    if (!need) return;
    switch (need.kind) {
      case 'approve_outline':
        await needsActions?.approveOutline(need.stageId);
        await go.go();
        return;
      case 'unblock_stage':
        await needsActions?.unblock();
        await go.go();
        return;
      case 'tick_criterion':
        await needsActions?.tick(need.criterionId);
        await go.go();
        return;
      case 'wait_for_jobs':
        await go.go();
        return;
      case 'continue_budget':
        await go.continueRun();
        return;
      case 'large_job':
        await go.acknowledgeLargeJob(need.sections);
        return;
      default:
        return;
    }
  };

  return (
    <section aria-label="Go mode" className="mb-6 rounded-2xl bg-[var(--surface-container)] px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">rocket_launch</span>
        <div className="mr-auto">
          <h2 className="text-title text-[var(--on-surface)]">Go mode</h2>
          <p className="text-label text-[var(--on-surface-variant)]">
            Chooses the best next move for this stage and does it — and says whether it reasoned or actually ran something.
          </p>
        </div>
        {!expanded && (
          <button onClick={() => setOpen(true)} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]">
            Set up Go
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-4 space-y-4">
          <PolicySelector value={go.policy} onChange={go.setPolicy} disabled={go.active || go.phase === 'watching'} />
          <GoControl
            run={go.run}
            running={go.active}
            budget={go.budget}
            onBudget={go.setBudget}
            onGo={() => void go.go()}
            onStop={() => void go.stop()}
            canResume={canResume}
            canContinue={canContinue}
            disabled={go.phase === 'watching' || Boolean(go.pendingStep) || Boolean(go.authorizing)}
            hideResume={Boolean(need && needsActions && describeNeed(need, go.stageLabelFor).action)}
          />
          {need && <NeedsYouCard key={`${need.kind}:${go.run?.id}`} need={need} stageLabel={go.stageLabelFor} onAction={act} />}
          {go.phase === 'watching' && (
            <p role="status" className="text-body text-[var(--on-surface-variant)]">
              This run is being driven from another tab. It will continue here if that tab closes.
            </p>
          )}
          {go.authorizing && (
            <AuthorizationDialog
              policy={go.authorizing}
              budget={go.budget}
              onAuthorize={() => void go.confirmAuthorization()}
              onCancel={go.cancelAuthorization}
            />
          )}
          {go.error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-[var(--pm-tertiary)]/10 px-4 py-3 text-body text-[var(--on-surface)]">
              <span className="mr-auto">{go.error}</span>
              <button onClick={go.dismissError} className="text-label text-[var(--on-surface-variant)]">Dismiss</button>
            </div>
          )}
          {go.pendingStep && (
            <DecisionPrompt
              step={go.pendingStep}
              stale={go.pendingStale}
              onApprove={() => void go.approve()}
              onReplan={() => void go.replan()}
              onDecline={() => void go.decline()}
            />
          )}
          {askingUser && !need && !cleared && go.run?.stop_reason && (
            <QuestionPrompt key={go.run.stop_reason} question={go.run.stop_reason} onAnswer={(t) => void go.answer(t)} />
          )}
          {(go.run || go.steps.length > 0) && (
            <TransparencyPanel
              run={go.run}
              step={current}
              next={next}
              stageLabel={stageLabel}
              mode={mode}
              thinking={go.phase === 'thinking'}
            />
          )}
          <StepTimeline steps={go.steps} />
        </div>
      )}
    </section>
  );
}
