'use client';

import { useState } from 'react';

import type { StageDefinition, StageEvaluation } from '@/lib/workflow/types';
import type { TransitionOption } from '@/lib/workflow/engine';

interface Props {
  stage: StageDefinition;
  evaluation: StageEvaluation;
  options: TransitionOption[];
  onTransition: (option: TransitionOption, note?: string) => void;
}

/**
 * Stage transitions (FR-04): advance, remain, return, or skip.
 *
 * Every option stays visible even when criteria are unmet. "Guidance is
 * suggestive, not restrictive" — the system records the deviation and gets out
 * of the way rather than blocking. Advancing with something unmet relabels and
 * asks for a note; it is never disabled.
 */
export function StageTransitionBar({ stage, evaluation, options, onTransition }: Props) {
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
  const canConfirm = !isSkip || note.trim().length > 0;

  if (pending) {
    return (
      <div className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
        <p className="text-sm text-[var(--on-surface)]">
          {isSkip ? `Skipping ${stage.short_label}. Why?` : 'Moving on with unfinished items. Why?'}
        </p>

        {!isSkip && evaluation.unmet.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-[var(--on-surface-variant)]">
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
                className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
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
          placeholder={isSkip ? 'Or write your own reason' : 'Optional note'}
          className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-sm text-[var(--on-surface)] outline-none"
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-sm text-[var(--on-primary)] disabled:opacity-40"
          >
            {isSkip ? 'Skip stage' : 'Move on'}
          </button>
          <button
            onClick={() => setPending(null)}
            className="rounded-lg px-4 py-2 text-sm text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <span className="mr-auto text-xs text-[var(--on-surface-variant)]">
        {evaluation.canAdvance
          ? 'Ready to move on'
          : `${evaluation.unmet.length} item${evaluation.unmet.length === 1 ? '' : 's'} outstanding`}
      </span>

      {returns.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowReturns((v) => !v)}
            className="rounded-lg px-3 py-2 text-sm text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
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
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--on-surface)] hover:bg-[var(--surface-container-high)]"
                >
                  {option.label}
                </button>
              ))}
              {/* Returning never deletes later work; it marks it stale. */}
              <p className="px-4 py-2 text-[11px] leading-snug text-[var(--on-surface-variant)]">
                Later work is kept and flagged, not deleted.
              </p>
            </div>
          )}
        </div>
      )}

      {skip && (
        <button
          onClick={() => start(skip)}
          className="rounded-lg px-3 py-2 text-sm text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
        >
          Skip
        </button>
      )}

      {advance && (
        <button
          onClick={() => start(advance)}
          className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-sm font-medium text-[var(--on-primary)] transition-opacity hover:opacity-90"
        >
          {advance.label}
        </button>
      )}
    </div>
  );
}
