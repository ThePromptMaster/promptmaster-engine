'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { actionLabel } from '@/lib/agent/actions';
import { approvalsAskedFor, describeNeed, isClearedNote, needIsDecidedOnStage, type NeedContext, type StuckOption } from '@/lib/agent/needs';
import type { useGoLoop } from '../use-go-loop';
import { AuthorizationDialog } from './authorization-dialog';
import { DecisionPrompt, QuestionPrompt } from './decision-prompt';
import { GoControl } from './go-control';
import { NeedsYouCard } from './needs-you-card';
import { PolicySelector } from './policy-selector';
import { RoutineDecisions } from './routine-decisions';
import type { RoutineDecisions as RoutinePolicy } from '@/types/project';
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
  /** Skip the current stage, with the reason given. */
  skip?: (reason: string) => Promise<void>;
  /** Start the next round of a looping workflow: the user's return to its first stage. */
  nextRound?: (toStageId: string, reason: string) => Promise<void>;
  /** Bring the stage's table into view, at the first row still to decide. */
  showTable?: () => void;
  /** Bring the Data panel into view, where a file is attached. */
  showData?: () => void;
}

export function GoPanel({
  go,
  stageLabel,
  mode,
  needsActions,
  needContext,
  dockHost = null,
  routine,
}: {
  go: ReturnType<typeof useGoLoop>;
  stageLabel: string;
  mode: string;
  needsActions?: NeedsActions;
  /** What is true of the project now, for a request whose wording depends on it. */
  needContext?: NeedContext;
  /**
   * Where a pinned copy of the controls goes while the panel's own are
   * scrolled out of view: a sticky host at the top of the work column. The
   * client, 2 Oct: "you should see [the play button] all the time so you
   * don't have to keep scrolling back and forth".
   */
  dockHost?: HTMLElement | null;
  /** "Routine decisions": who may decide an approval Go can check (5 Oct). */
  routine?: { value: RoutinePolicy; onChange: (v: RoutinePolicy) => void };
}) {
  const [open, setOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [controlsInView, setControlsInView] = useState(true);
  useEffect(() => {
    const el = controlsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setControlsInView(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(el);
    return () => observer.disconnect();
  });
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
  // …except a used-up window the run is about to follow with another on its own.
  const carryingOn = go.run?.needs?.kind === 'continue_budget' && go.run.policy === 'autonomous' && go.autoPending;
  const need = !go.active && !go.pendingStep && !carryingOn && go.run?.needs && go.run.needs.kind !== 'answer_question' && (live || go.run.status === 'budget_exhausted')
    ? go.run.needs
    : null;
  // The status panel below already says so; this only keeps it from being asked as a question.
  const cleared = canResume && !need && isClearedNote(go.run?.stop_reason);
  const canContinue = Boolean(
    go.run && go.run.status === 'budget_exhausted' && go.run.policy === go.policy && go.run.budget_steps === go.budget
  );
  const act = async (option?: StuckOption) => {
    if (!need) return;
    switch (need.kind) {
      case 'approve_outline':
        await needsActions?.approveOutline(need.stageId);
        await go.go();
        return;
      case 'unblock_stage':
        // Adding data is done on the page; the card notices and offers Resume.
        if (option === 'add_data') {
          needsActions?.showData?.();
          return;
        }
        if (option === 'skip') {
          await needsActions?.unblock();
          await needsActions?.skip?.(`Marked stuck and skipped for now: ${need.reason}`);
          await go.go();
          return;
        }
        // Carry on by hand: the block is lifted and Go stays stopped; Resume
        // appears once the card notices the stage is no longer stuck.
        if (option === 'clear') {
          await needsActions?.unblock();
          return;
        }
        await needsActions?.unblock();
        await go.go();
        return;
      case 'tick_criterion':
        await needsActions?.tick(need.criterionId);
        await go.go();
        return;
      case 'skip_stage':
        await needsActions?.skip?.(need.reason);
        await go.go();
        return;
      case 'next_round':
        await needsActions?.nextRound?.(need.toStageId, need.reason);
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
      case 'decide_rows':
      case 'triage_findings':
        // The rows are the user's to decide one by one; the button only takes them there.
        needsActions?.showTable?.();
        return;
      default:
        return;
    }
  };

  const controlProps = {
    run: go.run,
    running: go.active,
    budget: go.budget,
    onBudget: go.setBudget,
    onGo: () => void go.go(),
    onStop: () => void go.stop(),
    canResume,
    canContinue,
    disabled: go.phase === 'watching' || Boolean(go.pendingStep) || Boolean(go.authorizing),
    // A suggestion to skip has two answers: the card's button, or Resume to do the stage.
    // A table's button only shows the way, so Resume stays beside it.
    hideResume: Boolean(need && need.kind !== 'skip_stage' && need.kind !== 'next_round' && !needIsDecidedOnStage(need) && needsActions && describeNeed(need, go.stageLabelFor, needContext).action),
  };
  // Something on the panel is waiting for the user: the pinned copy says so and takes them there.
  const waiting = Boolean(go.pendingStep || need || askingUser || go.authorizing);
  const dock =
    expanded && dockHost && !controlsInView
      ? createPortal(
          <section aria-label="Go buttons" className="rounded-xl bg-[var(--surface-container)] px-4 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <GoControl {...controlProps} compact />
              </div>
              <button
                onClick={() => sectionRef.current?.scrollIntoView({ block: 'start' })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-label ${
                  waiting ? 'bg-[var(--pm-tertiary)] text-white' : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                }`}
              >
                {waiting ? 'Go needs you — show' : go.active ? 'Show what Go is doing' : 'Show Go'}
              </button>
            </div>
          </section>,
          dockHost
        )
      : null;

  return (
    <section ref={sectionRef} aria-label="Go mode" className="mb-6 scroll-mt-20 rounded-2xl bg-[var(--surface-container)] px-5 py-4">
      {dock}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">rocket_launch</span>
        <div className="mr-auto">
          <h2 className="text-title text-[var(--on-surface)]">Go mode</h2>
          <p className="text-label text-[var(--on-surface-variant)]">
            Chooses the best next move for this stage and does it — and says whether it analyzed something or actually ran it.
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
          {routine && <RoutineDecisions value={routine.value} onChange={routine.onChange} />}
          <div ref={controlsRef}>
            <GoControl {...controlProps} />
          </div>
          {need && (
            <NeedsYouCard
              key={`${need.kind}:${go.run?.id}`} need={need} stageLabel={go.stageLabelFor} onAction={act} context={needContext}
              onCarryOn={need.kind === 'tick_criterion' && canResume ? () => void go.go() : undefined}
            />
          )}
          {go.phase === 'watching' && (
            <p role="status" className="text-body text-[var(--on-surface-variant)]">
              This run is being driven from another tab. It will continue here if that tab closes.
            </p>
          )}
          {go.authorizing && (
            <AuthorizationDialog
              policy={go.authorizing}
              budget={go.budget}
              autoWindows={go.autoWindows}
              onAutoWindows={go.setAutoWindows}
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
            <QuestionPrompt
              key={go.run.stop_reason}
              question={go.run.stop_reason}
              onAnswer={(t, contradicted) => void go.answer(t, contradicted)}
              checkAnswer={go.checkAnswer}
              approvals={approvalsAskedFor(go.run.stop_reason, needContext?.openApprovals)}
              onTick={
                needsActions
                  ? async (a) => {
                      await needsActions.tick(a.id);
                      await go.answer(`I ticked “${a.label}”.`);
                    }
                  : undefined
              }
            />
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
