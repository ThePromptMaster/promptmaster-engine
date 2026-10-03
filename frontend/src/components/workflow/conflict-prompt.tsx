'use client';

import { useState } from 'react';

import { describeWith, type Controls, type InstructionConflict } from '@/lib/workflow/instruction-conflicts';
import { recommendedControl } from '@/lib/workflow/precedence';

const KIND: Record<InstructionConflict['kind'], string> = {
  objective: 'your objective',
  constraint: 'your constraints',
  decision: 'a decision you made earlier',
  instruction: 'another pending instruction',
};

/**
 * PM-24: "user should be asked which should control when there is a real
 * conflict." Asked once per conflict, answered with one click each; nothing is
 * sent until the user continues, and the answers go on the decision trail.
 */
export function ConflictPrompt({
  instruction,
  conflicts,
  busy,
  onContinue,
  onCancel,
}: {
  instruction: string;
  conflicts: InstructionConflict[];
  busy: boolean;
  onContinue: (choices: Controls[]) => void;
  onCancel: () => void;
}) {
  // The order recommends a side ("choose the higher one", 3 Oct call); the
  // user still chooses, and can change it with one click.
  const [choices, setChoices] = useState<(Controls | null)[]>(conflicts.map((c) => recommendedControl(c.kind)));
  const ready = choices.every((c) => c !== null);
  return (
    <section aria-label="Which takes priority?" className="rounded-xl bg-[var(--surface-container-high)] px-4 py-3">
      <p className="text-label uppercase tracking-wide text-[var(--pm-tertiary)]">
        {conflicts.length === 1 ? 'This instruction conflicts with something' : `This instruction conflicts with ${conflicts.length} things`}
      </p>
      <p className="mt-1 text-body text-[var(--on-surface)]">&ldquo;{instruction}&rdquo;</p>
      <ol className="mt-3 space-y-3">
        {conflicts.map((c, i) => (
          <li key={`${c.kind}-${c.with_id}-${i}`}>
            <p className="text-body text-[var(--on-surface)]">
              It pulls against {KIND[c.kind]}: <span className="italic">{c.with_text}</span>
            </p>
            <p className="text-label text-[var(--on-surface-variant)]">{c.explanation}</p>
            <div role="radiogroup" aria-label={`Which takes priority (${i + 1})`} className="mt-1.5 flex flex-wrap gap-2">
              {(['new', 'existing'] as const).map((value) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={choices[i] === value}
                  onClick={() => setChoices((prev) => prev.map((p, j) => (j === i ? value : p)))}
                  className={`rounded-lg px-3 py-1.5 text-label ${
                    choices[i] === value
                      ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                      : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                  }`}
                >
                  {value === 'new' ? 'My new instruction takes priority' : `Keep ${describeWith(c)}`}
                  {recommendedControl(c.kind) === value && ' (recommended)'}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {/* Pinned to the bottom of the chat thread's scroll area, so Continue is in
          reach however many conflicts are listed and however short the window. */}
      <div className="sticky bottom-0 -mx-4 mt-3 flex gap-2 bg-[var(--surface-container-high)] px-4 py-2">
        <button
          onClick={() => onContinue(choices as Controls[])}
          disabled={!ready || busy}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-medium text-[var(--on-primary)] disabled:opacity-40"
        >
          Continue
        </button>
        <button onClick={onCancel} className="rounded-lg px-3 py-2 text-label text-[var(--on-surface-variant)]">
          Cancel
        </button>
      </div>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">Recommended follows PromptMaster&apos;s order — your objective, then your decisions, then your newest instruction, then the stage and the constraints. Your choice is recorded, and PromptMaster is told which one takes priority.</p>
    </section>
  );
}
