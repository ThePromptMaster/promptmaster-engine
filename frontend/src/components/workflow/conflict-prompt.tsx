'use client';

import { useState } from 'react';

import { choiceLabels, gist, type Controls, type InstructionConflict } from '@/lib/workflow/instruction-conflicts';
import { recommendedControl } from '@/lib/workflow/precedence';

/**
 * PM-24: "user should be asked which should control when there is a real
 * conflict."
 *
 * One question, in plain words (14 Oct, Sean, LANTERN): the screen had listed
 * several overlapping priority choices whose buttons repeated raw instruction
 * text, and recommended "My new instruction takes priority" against "only
 * Elena can approve a change". Now the first conflict — a recorded approval
 * first — is the question, said once with what keeping the record means, and
 * answered with one click on a short label. Any others are folded below,
 * already set to their recommended side. Overriding a recorded approval is
 * possible, but explicit: it asks once more, and says what it means.
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
  const recommended = conflicts.map((c) => recommendedControl(c.kind, c.protects_approval));
  const [others, setOthers] = useState<(Controls | null)[]>(recommended);
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const lead = conflicts[0];
  if (!lead) return null;
  const labels = choiceLabels(lead);
  const leadRecommended = recommended[0];

  const choose = (controls: Controls) => {
    if (controls === 'new' && lead.protects_approval && !confirmingOverride) {
      setConfirmingOverride(true);
      return;
    }
    // The rest follow their own recommendation, or this answer where the order has none.
    onContinue([controls, ...others.slice(1).map((o) => o ?? controls)]);
  };

  const options: { value: Controls; label: string }[] = [
    { value: 'existing', label: labels.keep },
    { value: 'new', label: labels.override },
  ];
  // The recommended answer is the primary button.
  if (leadRecommended === 'new') options.reverse();
  const rest = conflicts.slice(1);

  return (
    <section aria-label="Which takes priority?" className="rounded-xl bg-[var(--surface-container-high)] px-4 py-3">
      <p className="text-label uppercase tracking-wide text-[var(--pm-tertiary)]">Before I change this</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">
        {lead.resolution && leadRecommended !== 'new' ? `${lead.explanation.trim()} ${lead.resolution.trim()}` : lead.explanation}
      </p>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">Your instruction: {gist(instruction, 160)}</p>

      {confirmingOverride ? (
        <div role="alertdialog" aria-label="Override the recorded approval?" className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
          <p className="text-body text-[var(--on-surface)]">
            {lead.explanation.trim()} Overriding the recorded approval treats the change as approved. Do this only if that approval has actually been given.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => choose('new')}
              disabled={busy}
              className="rounded-lg bg-[var(--surface-container-highest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-40"
            >
              {labels.override}
            </button>
            <button
              onClick={() => setConfirmingOverride(false)}
              className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((o, i) => (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              disabled={busy}
              className={`rounded-lg px-3 py-1.5 text-label disabled:opacity-40 ${
                i === 0 && leadRecommended !== null
                  ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                  : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
              }`}
            >
              {o.label}
              {leadRecommended === o.value && ' (recommended)'}
            </button>
          ))}
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
            Cancel
          </button>
        </div>
      )}

      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">
            Also affected ({rest.length}) — set to the recommended choice
          </summary>
          <ul className="mt-2 space-y-2">
            {rest.map((c, j) => {
              const i = j + 1;
              const l = choiceLabels(c);
              return (
                <li key={`${c.kind}-${c.with_id}-${i}`}>
                  <p className="text-label text-[var(--on-surface)]">{c.explanation}</p>
                  <div role="radiogroup" aria-label={`Also affected (${i})`} className="mt-1 flex flex-wrap gap-2">
                    {(['existing', 'new'] as const).map((value) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={(others[i] ?? null) === value}
                        onClick={() => setOthers((prev) => prev.map((p, k) => (k === i ? value : p)))}
                        className={`rounded-lg px-2.5 py-1 text-label ${
                          others[i] === value
                            ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                            : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
                        }`}
                      >
                        {value === 'existing' ? l.keep : l.override}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">Your choice is recorded, and PromptMaster is told which one takes priority.</p>
    </section>
  );
}
