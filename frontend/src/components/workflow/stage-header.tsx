'use client';

import { useState } from 'react';

import { MODE_DISPLAY } from '@/lib/constants';
import type { StageDefinition, StageStatus } from '@/lib/workflow/types';

const STATUS_LABEL: Partial<Record<StageStatus, string>> = {
  complete: 'Complete',
  skipped: 'Skipped',
  stale: 'Needs another look',
};

interface Props {
  stage: StageDefinition;
  status: StageStatus;
  skippedReason?: string;
  onPickMode?: (mode: string) => void;
}

export function StageHeader({ stage, status, skippedReason, onPickMode }: Props) {
  const [showGuidance, setShowGuidance] = useState(true);

  return (
    <header className="mb-6">
      <div className="mb-1 flex items-center gap-3">
        <h2 className="text-[1.75rem] leading-tight tracking-tight text-[var(--on-surface)]">
          {stage.label}
        </h2>
        {STATUS_LABEL[status] && (
          <span className="rounded-full bg-[var(--surface-container-high)] px-2.5 py-1 text-[11px] uppercase tracking-wide text-[var(--on-surface-variant)]">
            {STATUS_LABEL[status]}
          </span>
        )}
        {!stage.required && (
          <span className="text-[11px] uppercase tracking-wide text-[var(--on-surface-variant)]">
            optional
          </span>
        )}
      </div>

      {status === 'skipped' && skippedReason && (
        <p className="mb-3 text-sm text-[var(--on-surface-variant)]">
          Skipped — {skippedReason}
        </p>
      )}

      {showGuidance && stage.entry_guidance && (
        <div className="relative mb-4 rounded-xl bg-[var(--surface-container-low)] px-5 py-4 pr-10">
          <p className="text-sm leading-relaxed text-[var(--on-surface-variant)]">
            {stage.entry_guidance}
          </p>
          <button
            onClick={() => setShowGuidance(false)}
            aria-label="Hide guidance"
            className="absolute right-3 top-3 text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {stage.recommended_modes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--on-surface-variant)]">Suited to this stage:</span>
          {stage.recommended_modes.map((rec) => (
            <button
              key={rec.mode}
              onClick={() => onPickMode?.(rec.mode)}
              // The reason matters more than the label: a recommendation
              // without a rationale is just another thing telling you what to do.
              title={rec.reason}
              className="group rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--surface-container-high)]"
            >
              <span className="block text-xs text-[var(--on-surface)]">
                {MODE_DISPLAY[rec.mode]?.display_name ?? rec.mode}
              </span>
              <span className="block text-[11px] leading-snug text-[var(--on-surface-variant)]">
                {rec.reason}
              </span>
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
