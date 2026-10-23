'use client';

import { useT } from '@/lib/i18n/i18n-provider';
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
  const recommended = conflicts.map((c) => recommendedControl(c.kind, c.protects_approval, c.instruction_authorised));
  const t = useT();
  const [others, setOthers] = useState<(Controls | null)[]>(recommended);
  // Folded choices the user set by hand; the rest follow the answer above.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const lead = conflicts[0];
  if (!lead) return null;
  const labels = choiceLabels(lead);
  const leadRecommended = recommended[0];

  const choose = (controls: Controls) => {
    if (controls === 'new' && lead.protects_approval && !lead.instruction_authorised && !confirmingOverride) {
      setConfirmingOverride(true);
      return;
    }
    // Applying the change carries the rest with it (17 Oct, Sean, NORTHSTAR-2:
    // "Also affected" kept a second copy of the withdrawn exception while the
    // answer above withdrew it) — except an approval this instruction does not
    // itself record. Keeping the record leaves each to its own recommendation.
    // A choice set by hand stands.
    onContinue([
      controls,
      ...conflicts.slice(1).map((c, j) => {
        const i = j + 1;
        if (touched.has(i)) return others[i] ?? controls;
        if (controls === 'new') return c.protects_approval && !c.instruction_authorised ? 'existing' : 'new';
        return recommended[i] ?? controls;
      }),
    ]);
  };

  const options: { value: Controls; label: string }[] = [
    { value: 'existing', label: labels.keep },
    { value: 'new', label: labels.override },
  ];
  // The recommended answer is the primary button.
  if (leadRecommended === 'new') options.reverse();
  const rest = conflicts.slice(1);

  return (
    <section aria-label={t('cp.label')} className="rounded-xl bg-[var(--surface-container-high)] px-4 py-3">
      <p className="text-label uppercase tracking-wide text-[var(--pm-tertiary)]">{t('cp.before')}</p>
      <p className="mt-1 text-body text-[var(--on-surface)]">
        {lead.resolution && leadRecommended !== 'new' ? `${lead.explanation.trim()} ${lead.resolution.trim()}` : lead.explanation}
      </p>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('cp.yourInstruction', { text: gist(instruction, 160) })}</p>

      {confirmingOverride ? (
        <div role="alertdialog" aria-label={t('cp.overrideLabel')} className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
          <p className="text-body text-[var(--on-surface)]">
            {lead.explanation.trim()} {t('cp.overrideWarn')}
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
              {t('cp.back')}
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
              {leadRecommended === o.value && t('cp.recommended')}
            </button>
          ))}
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-label text-[var(--on-surface-variant)]">
            {t('cp.cancel')}
          </button>
        </div>
      )}

      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-label text-[var(--on-surface-variant)]">
            {t('cp.alsoAffected', { count: rest.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {rest.map((c, j) => {
              const i = j + 1;
              const l = choiceLabels(c);
              return (
                <li key={`${c.kind}-${c.with_id}-${i}`}>
                  <p className="text-label text-[var(--on-surface)]">{c.explanation}</p>
                  <div role="radiogroup" aria-label={t('cp.alsoGroup', { n: i })} className="mt-1 flex flex-wrap gap-2">
                    {(['existing', 'new'] as const).map((value) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={touched.has(i) && others[i] === value}
                        onClick={() => {
                          setOthers((prev) => prev.map((p, k) => (k === i ? value : p)));
                          setTouched((prev) => new Set(prev).add(i));
                        }}
                        className={`rounded-lg px-2.5 py-1 text-label ${
                          touched.has(i) && others[i] === value
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
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('cp.recorded')}</p>
    </section>
  );
}
