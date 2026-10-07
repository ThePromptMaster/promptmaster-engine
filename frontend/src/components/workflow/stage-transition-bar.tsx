'use client';

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
  primary,
  onSuggest,
  suggesting = false,
  onPrimary,
  more = [],
  nextStageLabel = null,
  elsewhere = [],
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
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
            ? `Skipping ${stage.short_label}. Why?`
            : overriding
              ? 'You are overriding something this stage requires. Say why — the reason is kept on the record, and the stage stays open.'
              : 'Moving on with unfinished items. Why?'}
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
          placeholder={isSkip ? 'Or write your own reason' : overriding ? 'Reason for the override (required)' : 'Optional note'}
          aria-label={overriding ? 'Reason for the override' : undefined}
          className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
          >
            {isSkip ? 'Skip stage' : overriding ? 'Override and continue' : 'Move on'}
          </button>
          <button
            onClick={() => setPending(null)}
            className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const elsewhereNote = elsewhere.length
    ? ` · ${elsewhere.length} still open: ${elsewhere.join('; ')}`
    : '';
  const statusLine = evaluation.canAdvance
    ? `Ready to move on${elsewhereNote}`
    : `${evaluation.unmet.length} item${evaluation.unmet.length === 1 ? '' : 's'} outstanding${elsewhereNote}`;

  if (primary) {
    const primaryIsTransition = primary.kind === 'continue' || primary.kind === 'finish';
    const menu: MoreAction[] = [
      // PM-23: the planner's best move, with its reasons — behind More, so the
      // bar keeps one primary action (PM-06).
      ...(onSuggest
        ? [{ id: 'suggest', label: suggesting ? 'Thinking…' : 'Suggest a move', icon: 'lightbulb', onSelect: onSuggest, disabled: suggesting }]
        : []),
      ...more,
      // The transitions come from the same function Go's list of this page's
      // buttons is built from (lib/workflow/stage-controls.ts).
      ...transitionEntries({ primary, options, nextStageLabel }).map((entry) => ({
        ...entry,
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
          aria-label="Stage actions"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
        >
          <div className="mr-auto min-w-0">
            <span className="block text-label text-[var(--on-surface-variant)]">{statusLine}</span>
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
                {whyOpen ? 'Hide why' : 'Why this?'}
                <span aria-hidden className="material-symbols-outlined text-[14px]">{whyOpen ? 'expand_less' : 'expand_more'}</span>
              </button>
            )}
            {whyOpen && primary.because && (
              <ul aria-label="Why this is the next step" className="mt-1 list-disc space-y-0.5 pl-5 text-label text-[var(--on-surface)]">
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
                More
                <span aria-hidden className="material-symbols-outlined text-[18px]">expand_more</span>
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 z-10 mb-1 min-w-[240px] rounded-lg bg-[var(--surface-container-highest)] py-1 shadow-lg"
                >
                  {menu.map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      disabled={item.disabled || busy}
                      onClick={() => {
                        setMenuOpen(false);
                        item.onSelect();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left text-body text-[var(--on-surface)] hover:bg-[var(--surface-container-high)] disabled:opacity-40"
                    >
                      <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--on-surface-variant)]">
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  ))}
                  {returns.length > 0 && (
                    <p className="px-4 py-2 text-label leading-snug text-[var(--on-surface-variant)]">
                      Going back keeps later work and flags it, never deletes it.
                    </p>
                  )}
                </div>
              )}
            </div>
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
              {busy ? 'Saving…' : primary.label}
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
      aria-label="Stage actions"
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
            Go back
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
                Later work is kept and flagged, not deleted.
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
          Skip
        </button>
      )}

      {advance && (
        <button
          onClick={() => start(advance)}
          disabled={busy}
          className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : advance.label}
        </button>
      )}
    </div>
    </div>
  );
}
