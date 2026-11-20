'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useState } from 'react';

import {
  approverOf,
  choiceLabels,
  gist,
  isUnconfirmedApproval,
  MIN_SOURCE_CHARS,
  type ApprovalReport,
  type Controls,
  type InstructionConflict,
} from '@/lib/workflow/instruction-conflicts';
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
 * already set to their recommended side.
 *
 * An approval the record waits on is never applied on a request's word (L-263,
 * Sean, 19 Nov: a trainer's message drew "Mark director authorization
 * approved"). The second answer is the user saying they hold the approval;
 * it asks them to confirm that, and where it is recorded, and passes both on
 * so the approval is saved with its source.
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
  onContinue: (choices: Controls[], approval?: ApprovalReport) => void;
  onCancel: () => void;
}) {
  const recommended = conflicts.map((c) => recommendedControl(c.kind, c.protects_approval, c.instruction_authorised));
  const t = useT();
  const [others, setOthers] = useState<(Controls | null)[]>(recommended);
  // Folded choices the user set by hand; the rest follow the answer above.
  const [touched, setTouched] = useState<ReadonlySet<number>>(new Set());
  const [reporting, setReporting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [source, setSource] = useState('');
  const lead = conflicts[0];
  if (!lead) return null;
  const labels = choiceLabels(lead);
  const leadRecommended = recommended[0];
  const approver = approverOf(lead);
  const sourceReady = source.trim().length >= MIN_SOURCE_CHARS;

  const choose = (controls: Controls, approval?: ApprovalReport) => {
    if (controls === 'new' && isUnconfirmedApproval(lead) && !approval) {
      setReporting(true);
      return;
    }
    // Applying the change carries the rest with it (17 Oct, Sean, NORTHSTAR-2:
    // "Also affected" kept a second copy of the withdrawn exception while the
    // answer above withdrew it) — except an approval this instruction does not
    // itself record. Keeping the record leaves each to its own recommendation.
    // A choice set by hand stands.
    // An approval below the first is never applied from here: only the
    // question above confirms one, with its source.
    const choices: Controls[] = [
      controls,
      ...conflicts.slice(1).map((c, j): Controls => {
        const i = j + 1;
        if (isUnconfirmedApproval(c)) return 'existing';
        if (touched.has(i)) return others[i] ?? controls;
        if (controls === 'new') return 'new';
        return recommended[i] ?? controls;
      }),
    ];
    if (approval) onContinue(choices, approval);
    else onContinue(choices);
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

      {reporting ? (
        <div role="alertdialog" aria-label={approver ? t('cp.reportLabel', { approver }) : t('cp.reportLabelAny')} className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2">
          <p className="text-body font-medium text-[var(--on-surface)]">{approver ? t('cp.reportLabel', { approver }) : t('cp.reportLabelAny')}</p>
          <p className="mt-1 text-body text-[var(--on-surface)]">{approver ? t('cp.reportWarn', { approver }) : t('cp.reportWarnAny')}</p>
          <label className="mt-2 flex items-start gap-2 text-label text-[var(--on-surface)]">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>{approver ? t('cp.reportConfirm', { approver }) : t('cp.reportConfirmAny')}</span>
          </label>
          <label className="mt-2 block text-label text-[var(--on-surface-variant)]">
            {t('cp.reportSource')}
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t('cp.reportSourceHint')}
              maxLength={300}
              className="mt-1 block w-full rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1.5 text-body text-[var(--on-surface)]"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => choose('new', { approver, source: source.trim() })}
              disabled={busy || !confirmed || !sourceReady}
              className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-40"
            >
              {t('cp.reportApply')}
            </button>
            <button
              onClick={() => setReporting(false)}
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
                    {(isUnconfirmedApproval(c) ? (['existing'] as const) : (['existing', 'new'] as const)).map((value) => (
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
