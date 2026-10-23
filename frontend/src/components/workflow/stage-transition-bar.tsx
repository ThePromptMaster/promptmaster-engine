'use client';

import type { MessageKey } from '@/lib/i18n/messages/en';
import { useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import type { StageDefinition, StageEvaluation } from '@/lib/workflow/types';
import type { TransitionOption } from '@/lib/workflow/engine';
import type { StageAction } from '@/lib/workflow/next-action';
import { transitionEntries } from '@/lib/workflow/stage-controls';

/** An action offered under "More" (PM-06). */
export interface MoreAction {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
  disabled?: boolean;
  /**
   * The heading it sits under, and one line on what it does (12 Oct; Colette
   * and Sean: many buttons, and no way to tell which to use or what it does).
   */
  group?: string;
  hint?: string;
}

/** Group headings, in menu order. Entries with no group go first. */
export const MORE_GROUPS = {
  stage: 'This stage',
  rewrite: 'Rewrite — saves a new version, keeps this one',
  critique: 'Get a second opinion — changes nothing',
  move: 'Move between stages',
} as const;

const GROUP_ORDER: readonly string[] = Object.values(MORE_GROUPS);

/** A group's heading in the interface's language; the English names above order the menu. */
const GROUP_KEY: Record<string, MessageKey> = {
  [MORE_GROUPS.stage]: 'more.stage',
  [MORE_GROUPS.rewrite]: 'more.rewrite',
  [MORE_GROUPS.critique]: 'more.critique',
  [MORE_GROUPS.move]: 'more.move',
};

/** Entries in group order, each group's own order kept, so a heading appears once. */
export function byGroup(items: readonly MoreAction[]): MoreAction[] {
  const rank = (a: MoreAction) => (a.group ? GROUP_ORDER.indexOf(a.group) : -1);
  return items.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(({ a }) => a);
}

interface Props {
  stage: StageDefinition;
  evaluation: StageEvaluation;
  options: TransitionOption[];
  onTransition: (option: TransitionOption, note?: string) => void;
  /** A transition is being written; the buttons wait rather than double-submit. */
  busy?: boolean;
  /** Why the last transition failed, in words the user can act on. */
  error?: string | null;
  /** A stage's name as the page shows it, for "Go back to …" under More. */
  stageName?: (stageId: string) => string | undefined;
  /**
   * PM-06: the one thing to do next. When given, the bar shows a single
   * primary button and puts every other action — including the transitions
   * that are not the primary — behind "More".
   */
  primary?: StageAction;
  /** Runs a non-transition primary (save, draft, evaluate, apply fixes). */
  onPrimary?: () => void;
  /** Stage actions other than transitions (Regenerate, Evaluate, …). */
  more?: MoreAction[];
  /** Short label of the next stage, for "Continue to …" under More. */
  nextStageLabel?: string | null;
  /** PM-23: ask PromptMaster for the best next move (one Guided planner call). */
  onSuggest?: () => void;
  suggesting?: boolean;
  /**
   * Work still open beyond this stage's own criteria — other stages, and
   * findings or proposals left on this one — one line each (`outstandingWork`).
   * "Ready to move on" is about this stage; this keeps it from reading as
   * "nothing is outstanding" for the project (6 Oct).
   */
  elsewhere?: readonly string[];
  /**
   * What is running instead of the primary action ("Checking this stage…").
   * The button stays where it was, disabled and saying so, rather than
   * vanishing (14 Oct, Sean: "This button seems to not work sometimes").
   */
  working?: string | null;
  /** What the last action did, beside the bar ("Checked — the results are above"). */
  done?: string | null;
  /** This is the last stage, done, and the project's objective is not met (13 Oct, Sean, workshop). */
  projectOpen?: boolean;
  /** What the latest check holds against this draft — Go will not move on past it (`checkVerdict`). */
  checkSays?: string | null;
}

/**
 * Stage transitions (FR-04): advance, remain, return, or skip.
 *
 * Every option stays visible even when criteria are unmet. "Guidance is
 * suggestive, not restrictive" — the system records the deviation and gets out
 * of the way rather than blocking. Advancing with something unmet relabels and
 * asks for a note; it is never disabled.
 */
export function StageTransitionBar({
  stage,
  evaluation,
  options,
  onTransition,
  busy = false,
  error = null,
  stageName,
  primary,
  onSuggest,
  suggesting = false,
  onPrimary,
  more = [],
  nextStageLabel = null,
  elsewhere = [],
  working = null,
  done = null,
  projectOpen = false,
  checkSays = null,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const t = useT();
  const [pending, setPending] = useState<TransitionOption | null>(null);
  const [note, setNote] = useState('');
  const [showReturns, setShowReturns] = useState(false);

  const advance = options.find((o) => o.kind === 'advance' || o.kind === 'finish');
  const skip = options.find((o) => o.kind === 'skip');
  const returns = options.filter((o) => o.kind === 'return');

  function start(option: TransitionOption) {
    if (option.requiresNote) {
      setPending(option);
      setNote('');
      return;
    }
    onTransition(option);
  }

  function confirm() {
    if (!pending) return;
    onTransition(pending, note.trim() || undefined);
    setPending(null);
    setNote('');
  }

  // A skip must carry a reason — the database makes skip-without-reason
  // unrepresentable, so the UI mirrors that rather than surfacing a constraint
  // violation after the fact.
  const isSkip = pending?.kind === 'skip';
  // Moving past something required is an override, and an override without
  // a reason is just "required" meaning "optional" (1 Oct, item 8).
  const overriding = Boolean(pending && !isSkip && evaluation.unmet.some((c) => c.blocking));
  const canConfirm = !(isSkip || overriding) || note.trim().length > 0;

  if (pending) {
    return (
      <div className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
        <p className="text-body text-[var(--on-surface)]">
          {isSkip
            ? t('tb.skipping', { stage: stage.short_label })
            : overriding
              ? t('tb.overriding')
              : t('tb.movingOn')}
        </p>

        {!isSkip && evaluation.unmet.length > 0 && (
          <ul className="mt-2 space-y-1 text-label text-[var(--on-surface-variant)]">
            {evaluation.unmet.map((c) => (
              <li key={c.id}>· {c.label}{c.detail ? ` — ${c.detail}` : ''}</li>
            ))}
          </ul>
        )}

        {isSkip && stage.skip_reasons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {stage.skip_reasons.map((reason) => (
              <button
                key={reason}
                onClick={() => setNote(reason)}
                className={`rounded-lg px-3 py-1.5 text-label transition-colors ${
                  note === reason
                    ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                    : 'bg-[var(--surface-container-highest)] text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          autoFocus
          placeholder={isSkip ? t('tb.ownReason') : overriding ? t('tb.reasonRequired') : t('tb.optionalNote')}
          aria-label={overriding ? t('tb.reason') : undefined}
          className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
          >
            {isSkip ? t('tb.skipStage') : overriding ? t('tb.overrideContinue') : t('tb.moveOn')}
          </button>
          <button
            onClick={() => setPending(null)}
            className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            {t('tb.cancel')}
          </button>
        </div>
      </div>
    );
  }

  const elsewhereNote = elsewhere.length
    ? t('tb.stillOpen', { count: elsewhere.length, items: elsewhere.join('; ') })
    : '';
  // 13 Oct (Sean's regression list, "contradictory readiness"): "Ready to
  // move on" beside open work read as two answers. With work open elsewhere it
  // says this stage is done, and where the rest is.
  const statusLine = evaluation.canAdvance
    ? checkSays
      ? t('tb.notReady', { says: checkSays })
      : projectOpen
      ? t('tb.projectOpen', { count: elsewhere.length || 1, items: elsewhere.join('; ') || t('tb.objectiveNotMet') })
      : elsewhere.length
      ? t('tb.doneElsewhere', { count: elsewhere.length, items: elsewhere.join('; ') })
      : t('tb.ready')
    : `${t('tb.outstanding', { count: evaluation.unmet.length })}${elsewhereNote}`;

  if (primary) {
    const primaryIsTransition = primary.kind === 'continue' || primary.kind === 'finish';
    const menu: MoreAction[] = [
      // PM-23: the planner's best move, with its reasons — behind More, so the
      // bar keeps one primary action (PM-06).
      ...(onSuggest
        ? [{ id: 'suggest', label: suggesting ? t('tb.thinking') : t('tb.suggest'), icon: 'lightbulb', onSelect: onSuggest, disabled: suggesting }]
        : []),
      ...byGroup(more),
      // The transitions come from the same function Go's list of this page's
      // buttons is built from (lib/workflow/stage-controls.ts).
      ...transitionEntries({ primary, options, nextStageLabel, stageName }).map((entry) => ({
        ...entry,
        group: MORE_GROUPS.move,
        onSelect: () => {
          const option = entry.id === 'advance' ? advance : entry.id === 'skip' ? skip : returns.find((o) => `return-${o.toStageId}` === entry.id);
          if (option) start(option);
        },
      })),
    ];

    return (
      <div>
        {error && (
          <p role="alert" className="mb-2 rounded-lg bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
            {error}
          </p>
        )}
        <div
          role="group"
          aria-label={t('tb.actions')}
          className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
        >
          <div className="mr-auto min-w-0">
            <span className="block text-label text-[var(--on-surface-variant)]">{statusLine}</span>
            {done && !working && (
              <span role="status" className="mt-0.5 flex items-center gap-1 text-label text-[var(--on-surface)]">
                <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--pm-success)]">check_circle</span>
                {done}
              </span>
            )}
            {primary.reason && (
              <span className="mt-0.5 block text-label text-[var(--on-surface-variant)] opacity-80">
                {primary.reason}
              </span>
            )}
            {/* PM-23: why this is the next step, from the facts that chose it. */}
            {primary.because && primary.because.length > 0 && (
              <button
                onClick={() => setWhyOpen((v) => !v)}
                aria-expanded={whyOpen}
                className="mt-1 inline-flex items-center gap-1 text-label text-[var(--pm-primary)]"
              >
                {whyOpen ? t('tb.hideWhy') : t('tb.why')}
                <span aria-hidden className="material-symbols-outlined text-[14px]">{whyOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
            )}
            {whyOpen && primary.because && (
              <ul aria-label={t('tb.whyLabel')} className="mt-1 list-disc space-y-0.5 pl-5 text-label text-[var(--on-surface)]">
                {primary.because.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>


          {menu.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
              >
                {t('tb.more')}
                <span aria-hidden className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 z-10 mb-1 max-h-[70vh] min-w-[240px] max-w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-lg bg-[var(--surface-container-highest)] py-1 shadow-lg"
                >
                  {menu.map((item, i) => (
                    <div key={item.id}>
                      {item.group && item.group !== menu[i - 1]?.group && (
                        <p role="presentation" className="px-4 pb-1 pt-2 text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
                          {GROUP_KEY[item.group] ? t(GROUP_KEY[item.group]) : item.group}
                        </p>
                      )}
                      <button
                        role="menuitem"
                        // The label is the name; the hint describes it, so a
                        // reader (and Go's list of this page's buttons) names it the same.
                        aria-label={item.label}
                        aria-describedby={item.hint ? `more-hint-${item.id}` : undefined}
                        disabled={item.disabled || busy}
                        onClick={() => {
                          setMenuOpen(false);
                          item.onSelect();
                        }}
                        className="flex w-full items-start gap-2 px-4 py-2 text-left text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
                      >
                        <span aria-hidden className="material-symbols-outlined mt-0.5 text-[18px] text-[var(--on-surface-variant)]">
                          {item.icon}
                        </span>
                        <span>
                          {item.label}
                          {item.hint && <span id={`more-hint-${item.id}`} className="block text-label text-[var(--on-surface-variant)]">{item.hint}</span>}
                        </span>
                      </button>
                    </div>
                  ))}
                  {returns.length > 0 && (
                    <p className="px-4 py-2 text-label leading-snug text-[var(--on-surface-variant)]">
                      {t('tb.goingBack')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {primary.kind === 'none' && working && (
            <button
              disabled
              aria-busy
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] opacity-60"
            >
              <span aria-hidden className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
              {working}
            </button>
          )}
          {primary.kind !== 'none' && (
            <button
              onClick={() => {
                if (primaryIsTransition) {
                  if (advance) start(advance);
                } else {
                  onPrimary?.();
                }
              }}
              disabled={busy}
              className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t('tb.saving') : primary.label}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
    {error && (
      <p role="alert" className="mb-2 rounded-lg bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
        {error}
      </p>
    )}
    <div
      role="group"
      aria-label={t('tb.actions')}
      className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <span className="mr-auto text-label text-[var(--on-surface-variant)]">
        {statusLine}
      </span>

      {returns.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowReturns((v) => !v)}
            className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
          >
            {t('tb.goBack')}
          </button>
          {showReturns && (
            <div className="absolute bottom-full right-0 z-10 mb-1 min-w-[200px] rounded-lg bg-[var(--surface-container-highest)] py-1 shadow-lg">
              {returns.map((option) => (
                <button
                  key={option.toStageId}
                  onClick={() => {
                    setShowReturns(false);
                    start(option);
                  }}
                  className="block w-full px-4 py-2 text-left text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                >
                  {option.label}
                </button>
              ))}
              {/* Returning never deletes later work; it marks it stale. */}
              <p className="px-4 py-2 text-label leading-snug text-[var(--on-surface-variant)]">
                {t('tb.keptFlagged')}
              </p>
            </div>
          )}
        </div>
      )}

      {skip && (
        <button
          onClick={() => start(skip)}
          className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          {t('tb.skip')}
        </button>
      )}

      {advance && (
        <button
          onClick={() => start(advance)}
          disabled={busy}
          className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t('tb.saving') : advance.label}
        </button>
      )}
    </div>
    </div>
  );
}
