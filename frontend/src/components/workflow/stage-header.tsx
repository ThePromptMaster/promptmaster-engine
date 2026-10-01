'use client';

import { useState } from 'react';

import { MODE_DISPLAY } from '@/lib/constants';
import type { StageDefinition, StageStatus } from '@/lib/workflow/types';

const STATUS_LABEL: Partial<Record<StageStatus, string>> = {
  complete: 'Complete',
  completed_with_artifact: 'Complete',
  blocked: 'Stuck',
  skipped: 'Skipped',
  stale: 'Needs another look',
};

interface Props {
  stage: StageDefinition;
  status: StageStatus;
  skippedReason?: string;
  /** 1-based position, for orientation within a 13-stage workflow. */
  position?: { index: number; total: number };
  onPickMode?: (mode: string) => void;
  /** The project's current mode, so the card in use is marked. */
  currentMode?: string;
  /** Moved past with something required still open. */
  leftOpen?: boolean;
  /** The stage the project is on. An open stage that is not, was left open or reopened. */
  isCurrent?: boolean;
}

export function StageHeader({ stage, status, skippedReason, position, onPickMode, currentMode, leftOpen, isCurrent = true }: Props) {
  const [showGuidance, setShowGuidance] = useState(true);
  // The header said nothing for an open stage, so the rail's "open" tag was
  // the only place a left-open stage was named (1 Oct, item 1).
  const statusLabel =
    status === 'in_progress' && !isCurrent ? (leftOpen ? 'Left open' : 'Reopened') : STATUS_LABEL[status];

  return (
    <header className="mb-8">
      {position && (
        <div className="mb-1.5 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
          Stage {position.index} of {position.total}
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-headline text-[var(--on-surface)]">{stage.label}</h2>
        {statusLabel && (
          <span className="rounded-full bg-[var(--surface-container-high)] px-2.5 py-0.5 text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
            {statusLabel}
          </span>
        )}
        {!stage.required && status !== 'skipped' && (
          <span className="text-label uppercase tracking-wide text-[var(--on-surface-variant)] opacity-70">
            optional
          </span>
        )}
      </div>

      {status === 'skipped' && skippedReason && (
        <p className="mt-2 text-body text-[var(--on-surface-variant)]">Skipped — {skippedReason}</p>
      )}

      {showGuidance && stage.entry_guidance && (
        // A left rule rather than another grey card: the guidance and the exit
        // criteria were the same tone, so the eye had nothing to rank them by.
        <div className="mt-4 flex items-start gap-3 border-l-2 border-[var(--pm-primary)] pl-4">
          <p className="max-w-[60ch] flex-1 text-body leading-relaxed text-[var(--on-surface-variant)]">
            {stage.entry_guidance}
          </p>
          <button
            onClick={() => setShowGuidance(false)}
            aria-label="Hide guidance"
            className="-mt-1 shrink-0 rounded-md p-1 text-[var(--on-surface-variant)] transition-colors hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {stage.recommended_modes.length > 0 && (
        <div className="mt-5">
          {/* Label above rather than beside: alongside a two-line chip it sat
              at the chip's vertical centre and read as misaligned. */}
          <div className="mb-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">
            {onPickMode ? 'How to think about this stage — pick a mode' : 'Suited to this stage'}
          </div>
          <div className="flex flex-wrap gap-2">
            {stage.recommended_modes.map((rec) => {
              const inUse = currentMode === rec.mode;
              return (
              <button
                key={rec.mode}
                // These looked like buttons and did nothing: onPickMode was
                // never passed. Picking one now sets the mode every generation
                // on this project is shaped by.
                onClick={() => onPickMode?.(rec.mode)}
                disabled={!onPickMode}
                aria-pressed={onPickMode ? inUse : undefined}
                className={`min-w-[220px] max-w-[380px] flex-1 rounded-xl px-4 py-3 text-left transition-colors disabled:cursor-default ${
                  inUse
                    ? 'bg-[var(--surface-container-high)] ring-2 ring-[var(--pm-primary)]/50'
                    : 'bg-[var(--surface-container-low)] hover:bg-[var(--surface-container-high)]'
                }`}
              >
                <span className="flex items-center justify-between gap-2 text-title text-[var(--on-surface)]">
                  {MODE_DISPLAY[rec.mode]?.display_name ?? rec.mode}
                  {inUse && (
                    <span className="text-label font-normal text-[var(--pm-primary)]">In use</span>
                  )}
                </span>
                {/* The reason matters more than the label — a recommendation
                    without one is just another thing telling you what to do. */}
                <span className="mt-0.5 block text-label leading-snug text-[var(--on-surface-variant)]">
                  {rec.reason}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}
