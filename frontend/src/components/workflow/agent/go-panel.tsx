'use client';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { shownStopReason } from '@/lib/i18n/stop-reasons';
import { shownModeName } from '@/lib/i18n/stage';
import { MODE_DISPLAY } from '@/lib/constants';
import type { ModeType } from '@/types';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { approvalsAskedFor, describeNeed, isClearedNote, needIsDecidedOnStage, type NeedContext, type StuckOption } from '@/lib/agent/needs';
import type { useGoLoop } from '../use-go-loop';
import { GoTerms } from './authorization-dialog';
import { DecisionPrompt, QuestionPrompt, type LatestChange } from './decision-prompt';
import { GoControl } from './go-control';
import { NeedsYouCard } from './needs-you-card';
import { PolicySelector } from './policy-selector';
import { RoutineDecisions } from './routine-decisions';
import type { RoutineDecisions as RoutinePolicy } from '@/types/project';
import type { AgentStep } from '@/types/agent';
import { StepTimeline } from './step-timeline';
import { RunAccountCard } from './run-account';
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
  /** Keep a reopened stage as it is now: its recheck is dismissed, on that stage only. */
  keepStage?: (stageId: string) => Promise<void>;
  /** Show a stage on the page. */
  openStage?: (stageId: string) => void;
}

export function GoPanel({
  go,
  stageLabel,
  mode,
  stageMode,
  needsActions,
  needContext,
  dockHost = null,
  routine,
  stageModes,
  latestChange = null,
  onApplyAnyway,
}: {
  go: ReturnType<typeof useGoLoop>;
  stageLabel: string;
  mode: string;
  /** The mode the current stage recommends. */
  stageMode?: string;
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
  /** 13 Oct: each stage in its own recommended mode, or the project's mode everywhere. */
  stageModes?: { value: 'stage' | 'project'; onChange: (v: 'stage' | 'project') => void };
  /** The latest version of the stage Go asks about, when it came from applied findings. */
  latestChange?: LatestChange | null;
  /** "Routine decisions": who may decide an approval Go can check (5 Oct). */
  routine?: { value: RoutinePolicy; onChange: (v: RoutinePolicy) => void };
  /** L-93: ask which takes priority about a record Go kept under the routine-decision policy. */
  onApplyAnyway?: (step: AgentStep) => void;
}) {
  const t = useT();
  const locale = useLocale();
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
  // The button's own word (Sean, 10 Oct, email 6.3: the record said "press Go"
  // while the button read "Resume").
  const button = canResume ? t('go.resume') : canContinue ? t('go.continue') : t('go.go');
  const next = go.pendingStep
    ? t('go.nextWaiting', { step: go.stepLabel(go.pendingStep) })
    : go.phase === 'thinking' || go.phase === 'performing'
      ? t('go.nextAfter')
      : go.run?.status === 'completed'
        ? t('go.nextNothing')
        : t('go.nextPress', { button });
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
      case 'objective_check':
        // What each button does is on it (11 Oct): fix and check again, carry
        // on to what the workflow still holds, or stop here.
        if (option === 'fix') return go.fixObjective(need.items);
        if (option === 'stop') return go.stop();
        await go.go();
        return;
      case 'repair_stuck':
        // What each button does is on it (13 Oct): once more, keep it, or open it.
        if (option === 'keep') {
          await needsActions?.keepStage?.(need.stageId);
          await go.go();
          return;
        }
        if (option === 'open') {
          needsActions?.openStage?.(need.stageId);
          return;
        }
        await go.retryRepair(need.stageId);
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
    // Resume is also the way to update work a change reopened: with the
    // next-step bar out of the way while Go waits, it opens a fresh window
    // when this one is nearly spent, as "Apply and continue" did (18 Oct).
    onGo: () => void go.update(),
    onStop: () => void go.stop(),
    canResume,
    canContinue,
    disabled: go.phase === 'watching' || Boolean(go.pendingStep) || Boolean(go.authorizing),
    // A suggestion to skip has two answers: the card's button, or Resume to do the stage.
    // A table's button only shows the way, so Resume stays beside it.
    hideResume: Boolean(need && need.kind !== 'skip_stage' && need.kind !== 'next_round' && !needIsDecidedOnStage(need) && needsActions && describeNeed(need, go.stageLabelFor, needContext, locale).action),
  };
  // Something on the panel is waiting for the user: the pinned copy says so and takes them there.
  const waiting = Boolean(go.pendingStep || need || askingUser || go.authorizing);
  // The pinned copy carries the button Go is waiting for, not only a way to
  // find it (14 Oct, Sean: "the new go button for revisions doesn't show up
  // sometimes" — it was on the card, scrolled out of view, with Resume hidden).
  const needed = need ? describeNeed(need, go.stageLabelFor, needContext, locale) : null;
  const dockAction: { label: string; option?: StuckOption; acts: boolean } | null =
    needed && needsActions && !needIsDecidedOnStage(need!) && (needed.options?.[0] || needed.action)
      ? { label: needed.options?.[0]?.label ?? needed.action!, option: needed.options?.[0]?.id, acts: true }
      : askingUser
        ? { label: t('controls.answerGo'), acts: false }
        : null;
  const dock =
    expanded && dockHost && !controlsInView
      ? createPortal(
          <section aria-label={t('go.buttons')} className="max-lg:pointer-events-none max-lg:flex max-lg:justify-end lg:rounded-xl lg:bg-[var(--surface-container)] lg:px-4 lg:py-2 lg:shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            {/* On a phone or an iPad the pinned copy is one small button, not a
                bar over the text (Sean, 10 Oct, emails 6.11 and 8). */}
            <button
              onClick={() => (dockAction?.acts ? void act(dockAction.option).catch(() => sectionRef.current?.scrollIntoView({ block: 'start' })) : sectionRef.current?.scrollIntoView({ block: 'start' }))}
              className={`pointer-events-auto flex max-w-[80vw] items-center gap-1 rounded-full px-3 py-1.5 text-label shadow-[0_4px_12px_rgba(0,0,0,0.15)] lg:hidden ${
                waiting ? 'bg-[var(--pm-tertiary)] text-white' : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
              }`}
            >
              <span aria-hidden className="material-symbols-outlined text-[16px]">{go.active ? 'progress_activity' : 'play_arrow'}</span>
              <span className="truncate">{dockAction ? dockAction.label : waiting ? t('go.needsYou') : go.active ? t('go.working') : t('go.go')}</span>
            </button>
            <div className="hidden flex-wrap items-center gap-3 lg:flex">
              <div className="min-w-0 flex-1">
                <GoControl {...controlProps} compact />
              </div>
              {dockAction && (
                <button
                  onClick={() => (dockAction.acts ? void act(dockAction.option).catch(() => sectionRef.current?.scrollIntoView({ block: 'start' })) : sectionRef.current?.scrollIntoView({ block: 'start' }))}
                  className="shrink-0 rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] hover:opacity-90"
                >
                  {dockAction.label}
                </button>
              )}
              <button
                onClick={() => sectionRef.current?.scrollIntoView({ block: 'start' })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-label ${
                  waiting ? 'bg-[var(--pm-tertiary)] text-white' : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                }`}
              >
                {dockAction ? t('go.showWhy') : waiting ? t('go.needsYouShow') : go.active ? t('go.showDoing') : t('go.show')}
              </button>
            </div>
          </section>,
          dockHost
        )
      : null;

  return (
    <section ref={sectionRef} data-panel="go" aria-label="Go mode" className="mb-6 scroll-mt-20 rounded-2xl bg-[var(--surface-container)] px-5 py-4">
      {dock}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">rocket_launch</span>
        <div className="mr-auto">
          <h2 className="text-title text-[var(--on-surface)]">{t('go.title')}</h2>
          <p className="text-label text-[var(--on-surface-variant)]">
            {t('go.intro')}
          </p>
        </div>
        {!expanded && (
          <>
            {/* One clear action; the settings stay one click away (12 Oct, Colette: too many buttons). */}
            <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-2 text-label text-[var(--on-surface-variant)] underline-offset-2 hover:text-[var(--on-surface)] hover:underline">
              {t('go.setUp')}
            </button>
            {/* One click to delegate: Autonomous, routine decisions handled, then the authorization to confirm. */}
            <button
              onClick={() => {
                routine?.onChange('handle');
                setOpen(true);
                go.handsOff();
              }}
              className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)]"
            >
              {t('go.letRun')}
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-4 space-y-4">
          <PolicySelector value={go.policy} onChange={go.setPolicy} disabled={go.active || go.phase === 'watching'} />
          {routine && <RoutineDecisions value={routine.value} onChange={routine.onChange} />}
          <div ref={controlsRef}>
            <GoControl {...controlProps} />
          </div>
          {go.policy !== 'guided' && !live && (
            <GoTerms
              policy={go.policy}
              budget={go.budget}
              autoWindows={go.autoWindows}
              onAutoWindows={go.setAutoWindows}
              disabled={go.active || Boolean(go.authorizing)}
            />
          )}
          {need && (
            <NeedsYouCard
              key={`${need.kind}:${go.run?.id}`} need={need} stageLabel={go.stageLabelFor} onAction={act} context={needContext}
              onCarryOn={need.kind === 'tick_criterion' && canResume ? () => void go.go() : undefined}
            />
          )}
          {go.phase === 'watching' && (
            <p role="status" className="text-body text-[var(--on-surface-variant)]">
              {t('go.otherTab')}
            </p>
          )}
          {go.error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-[var(--pm-tertiary)]/10 px-4 py-3 text-body text-[var(--on-surface)]">
              <span className="mr-auto">{go.error}</span>
              <button onClick={go.dismissError} className="text-label text-[var(--on-surface-variant)]">{t('go.dismiss')}</button>
            </div>
          )}
          {go.pendingStep && (
            <DecisionPrompt
              step={go.pendingStep}
              stale={go.pendingStale}
              label={go.stepLabel(go.pendingStep)}
              effect={go.stepEffect(go.pendingStep)}
              onApprove={() => void go.approve()}
              onReplan={() => void go.replan()}
              onDecline={() => void go.decline()}
            />
          )}
          {askingUser && !need && !cleared && go.run?.stop_reason && (
            <QuestionPrompt
              key={go.run.stop_reason}
              question={shownStopReason(locale, go.run.stop_reason)}
              expertPackage={go.run.needs?.kind === 'answer_question' ? go.run.needs.expertPackage : undefined}
              choices={go.run.needs?.kind === 'answer_question' ? go.run.needs.choices : undefined}
              change={latestChange ?? undefined}
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
          {stageModes && stageMode && stageMode !== mode && mode !== 'custom' && (
            <label className="flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
              <input
                type="checkbox"
                checked={stageModes.value === 'project'}
                onChange={(e) => stageModes.onChange(e.target.checked ? 'project' : 'stage')}
              />
              {t('go.useMyMode', { mode: shownModeName(mode, MODE_DISPLAY[mode as ModeType]?.display_name ?? mode) })}
            </label>
          )}
          <RunAccountCard run={go.run} steps={go.steps} stageLabel={go.stageLabelFor} />
          {(go.run || go.steps.length > 0) && (
            <TransparencyPanel
              run={go.run}
              step={current}
              next={next}
              stageLabel={stageLabel}
              mode={mode}
              stageMode={stageMode}
              stageModes={stageModes?.value}
              thinking={go.phase === 'thinking'}
              stageName={go.stageLabelFor}
            />
          )}
          <StepTimeline steps={go.steps} stageName={go.stageLabelFor} onApplyAnyway={onApplyAnyway} />
        </div>
      )}
    </section>
  );
}
