'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';

import type { EvaluationResult } from '@/types';

import { blocksCompletion, shownOutstanding, type CompletionSummary, type OutstandingShow } from '@/lib/workflow/engine';
import type { ObjectiveAssessment } from '@/lib/workflow/objective';
import { readablePerformed } from '@/lib/agent/labels';
import type { BlockKind } from '@/lib/workflow/types';

const BLOCK_KINDS: { kind: BlockKind; label: string; hint: string }[] = [
  { kind: 'data_missing', label: 'Waiting on information', hint: 'Figures, sources or answers you do not have yet' },
  { kind: 'tool_missing', label: 'Needs a tool PromptMaster does not have', hint: 'e.g. running code, a database, a lab result' },
  { kind: 'needs_decision', label: 'Needs a decision', hint: 'Someone has to choose before this can go on' },
];

/** PM-13: "blocked" is a status with a reason, not a stage left quietly undone. */
export function BlockForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (block: { kind: BlockKind; reason: string }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<BlockKind>('data_missing');
  const [reason, setReason] = useState('');
  return (
    <section aria-label={t('ssp.markStuck')} className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="text-body text-[var(--on-surface)]">{t('ssp.waitingOn')}</p>
      <div role="radiogroup" aria-label={t('ssp.whyStuck')} className="mt-3 grid gap-2 sm:grid-cols-3">
        {BLOCK_KINDS.map((option) => (
          <button
            key={option.kind}
            role="radio"
            aria-checked={kind === option.kind}
            onClick={() => setKind(option.kind)}
            className={`rounded-lg px-3 py-2 text-start transition-colors ${
              kind === option.kind
                ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]'
                : 'bg-[var(--surface-container-highest)] text-[var(--on-surface)]'
            }`}
          >
            <span className="block text-label font-semibold">{t(`ssp.block.${option.kind}` as MessageKey)}</span>
            <span className="block text-label opacity-80">{t(`ssp.block.${option.kind}.hint` as MessageKey)}</span>
          </button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        aria-label={t('ssp.whatMissing')}
        placeholder={t('ssp.whatMissingPh')}
        className="mt-3 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onSubmit({ kind, reason: reason.trim() })}
          disabled={!reason.trim()}
          className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-title text-[var(--on-primary)] disabled:opacity-40"
        >
          {t('ssp.markStuck')}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          {t('pnl.cancel')}
        </button>
      </div>
    </section>
  );
}

export function BlockedNotice({ kind, reason, onUnblock }: { kind: BlockKind; reason: string; onUnblock: () => void }) {
  const t = useT();
  const label = BLOCK_KINDS.some((k) => k.kind === kind) ? t(`ssp.block.${kind}` as MessageKey) : t('ssp.stuck');
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <span aria-hidden className="material-symbols-outlined text-[var(--pm-tertiary)]">block</span>
      <div className="me-auto">
        <p className="text-title text-[var(--on-surface)]">{t('ssp.stuckLabel', { label: label.toLowerCase() })}</p>
        <p className="text-label text-[var(--on-surface-variant)]">{reason}</p>
      </div>
      <button onClick={onUnblock} className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)]">
        {t('ssp.continueStage')}
      </button>
    </div>
  );
}

/**
 * The objective is not met, though the workflow's stages may all be done
 * (7 Oct; Sean, 6 Oct, email 13: "the project should remain blocked or
 * paused, preserve the missing-input requirements, and resume when those
 * inputs arrive"). What is missing, what was done, what is only proposed.
 */
export function ObjectivePausedNotice({
  assessment,
  onResume,
  resumeDisabled = false,
  onAnswer,
  resumeLabel,
}: {
  assessment: ObjectiveAssessment;
  onResume?: () => void;
  resumeDisabled?: boolean;
  /**
   * Answer the blocker here, where it is shown: the answer is recorded as a
   * fact, the judged stage revised with it and Go carries on (13 Oct, Sean,
   * workshop: "Make it obvious … exactly where I should respond").
   */
  onAnswer?: (text: string) => Promise<void> | void;
  /**
   * The button's words when Go is waiting on this check: the same action the
   * Go panel offers (17 Oct, Sean, FIELDGUIDE: Output said "Have Go fix
   * Output and check again" while Summary said "Resume Go").
   */
  resumeLabel?: string;
}) {
  const t = useT();
  const ask = assessment.blockers.map((b) => b.ask?.trim()).find(Boolean);
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <section role="status" aria-label={t('ssp.objNotMet')} className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      {/* The button sits below the text, not beside it: beside it, a phone
          left the text one word wide (20 Oct, Sean, HARBOR screenshots). */}
      <div className="flex items-start gap-3">
        <span aria-hidden className="material-symbols-outlined text-[var(--pm-tertiary)]">pause_circle</span>
        <div className="min-w-0 flex-1">
          <p className="text-title text-[var(--on-surface)]">
            {assessment.blockers.length ? t('ssp.paused') : t('ssp.notMetYet')}
          </p>
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">{assessment.reason}</p>
          {assessment.blockers.length > 0 && (
            <>
              <p className="mt-2 text-label font-semibold text-[var(--on-surface)]">{t('ssp.waitingFor')}</p>
              <ul className="list-disc ps-5 text-label text-[var(--on-surface-variant)]">
                {assessment.blockers.map((b, i) => (
                  <li key={i}>{b.need}</li>
                ))}
              </ul>
            </>
          )}
          {/* 19 Oct (HARBOR): what the brief lets stay open is stated, not waited for. */}
          {(assessment.limitations?.length ?? 0) > 0 && (
            <>
              <p className="mt-2 text-label font-semibold text-[var(--on-surface)]">{t('ssp.limitations')}</p>
              <ul aria-label={t('ssp.limitationsLabel')} className="list-disc ps-5 text-label text-[var(--on-surface-variant)]">
                {assessment.limitations!.map((l, i) => (
                  <li key={i}>{l.item}</li>
                ))}
              </ul>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('ssp.allowedBy', { by: assessment.limitations![0].allowed_by })}</p>
            </>
          )}
          {ask && onAnswer && (
            <form
              aria-label={t('ssp.answerLabel')}
              className="mt-3 rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!answer.trim() || sending) return;
                setSending(true);
                void Promise.resolve(onAnswer(answer.trim())).finally(() => setSending(false));
              }}
            >
              <label htmlFor="objective-answer" className="text-label font-semibold text-[var(--on-surface)]">
                {t('ssp.respond', { ask })}
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  id="objective-answer"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value.slice(0, 600))}
                  className="min-w-0 flex-[1_1_12rem] rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-body text-[var(--on-surface)]"
                  placeholder={t('ssp.yourAnswer')}
                />
                <button
                  type="submit"
                  disabled={!answer.trim() || sending || resumeDisabled}
                  className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-label text-[var(--on-primary)] disabled:opacity-50"
                >
                  {sending ? t('ssp.recording') : t('ssp.recordContinue')}
                </button>
              </div>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">
                {t('ssp.recordedNote')}
              </p>
            </form>
          )}
          <p className="mt-2 text-label text-[var(--on-surface-variant)]">
            <span className="font-semibold text-[var(--on-surface)]">{t('ssp.done')}</span>
            {assessment.performed.length ? assessment.performed.map(readablePerformed).join('; ') : t('ssp.nothingPerformed')}
          </p>
          {assessment.proposed_next.length > 0 && (
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">
              <span className="font-semibold text-[var(--on-surface)]">{t('ssp.proposed')}</span>
              {assessment.proposed_next.join('; ')}
            </p>
          )}
          {onResume && !(ask && onAnswer) && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onResume}
                disabled={resumeDisabled}
                className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)] disabled:opacity-40"
              >
                {resumeLabel ?? (assessment.blockers.length ? t('ssp.addedResume') : t('ssp.resumeGo'))}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * PM-14: what finishing would be finishing. The deliverable is the question;
 * the stage counts are context. Finishing without the deliverable is allowed
 * — it is the user's project — but it is said out loud first.
 */
export function CompletionDialog({
  summary,
  busy,
  check,
  onCheck,
  onConfirm,
  onCancel,
  onViewStage,
  show,
}: {
  summary: CompletionSummary;
  /** How stage names and Go's request are said here; without it, the English the items hold. */
  show?: OutstandingShow;
  busy: boolean;
  /** The deliverable scored against the objective, when the user asks (PM-14). */
  check?: { running: boolean; result: EvaluationResult | null; error: string | null };
  onCheck?: () => void;
  /** With a reason when work was still open; the reason is recorded. */
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  /** Go and look at a stage that was left open, to close it before finishing. */
  onViewStage?: (stageId: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [reason, setReason] = useState('');
  // Left-open stages have their own line above; everything else still open is
  // listed here, and finishing past it asks why (6 Oct: the project "allowed
  // me to finish … despite the unresolved finding").
  const open = (summary.outstanding ?? []).filter((i) => i.kind !== 'unmet_blocking' || !summary.leftOpenStages.some((s) => s.id === i.stageId));
  // Optional rows are listed, and finishing past them needs no reason (C3).
  const needsReason = open.some(blocksCompletion);
  const rows: [string, number][] = [
    [t('ssp.row.completed'), summary.completed],
    [t('ssp.row.skipped'), summary.skipped],
    [t('ssp.row.leftOpen'), summary.leftOpen],
    [t('ssp.row.blocked'), summary.blocked],
    [t('ssp.row.notStarted'), summary.notStarted],
  ];
  return (
    <section aria-label={t('ssp.finishLabel')} className="rounded-xl bg-[var(--surface-container-high)] px-6 py-5">
      <h3 className="text-title text-[var(--on-surface)]">{t('ssp.finishQ')}</h3>
      <p className="mt-3 flex items-center gap-2 text-body text-[var(--on-surface)]">
        <span
          aria-hidden
          className={`material-symbols-outlined ${summary.deliverableDone ? 'text-[var(--pm-secondary)]' : 'text-[var(--pm-tertiary)]'}`}
        >
          {summary.deliverableDone ? 'task_alt' : 'error'}
        </span>
        {summary.deliverableDone
          ? t('ssp.delivDone', { name: summary.deliverable?.short_label ?? t('ssp.theMainWork') })
          : t('ssp.delivNotDone', { name: summary.deliverable?.short_label ?? t('ssp.theMainWork') })}
      </p>
      <p className="mt-2 text-label text-[var(--on-surface-variant)]">
        {t('ssp.stages', { list: rows.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`).join(' · ') || t('ssp.none') })}
      </p>
      {summary.leftOpenStages.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-[var(--on-surface-variant)]">
          <span>
            {t('ssp.leftOpenList', { count: summary.leftOpenStages.length, stages: summary.leftOpenStages.map((s) => (show?.stage ? show.stage(s.id, s.short_label) : s.short_label)).join(', ') })}
          </span>
          {onViewStage &&
            summary.leftOpenStages.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onViewStage(s.id)}
                className="rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-low)]"
              >
                {t('pnl.closeStage', { stage: show?.stage ? show.stage(s.id, s.short_label) : s.short_label })}
              </button>
            ))}
        </p>
      )}
      {!summary.deliverableDone && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          {t('ssp.finishWithout')}
        </p>
      )}
      {!needsReason && open.length > 0 && (
        // Optional rows only: named, and finishing needs no reason (C3, 8 Oct).
        <div role="group" aria-label={t('ssp.optional')} className="mt-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          <p className="text-label font-semibold text-[var(--on-surface)]">{t('ssp.optionalTitle')}</p>
          <ul className="mt-1 list-disc ps-5 text-label text-[var(--on-surface-variant)]">
            {open.map((item, i) => (
              <li key={i}>{shownOutstanding(item, locale, show)}</li>
            ))}
          </ul>
        </div>
      )}
      {needsReason && (
        <div role="group" aria-label={t('ssp.stillOpenLabel')} className="mt-3 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          <p className="text-label font-semibold text-[var(--on-surface)]">
            {t('ssp.stillOpen', { count: open.length })}
          </p>
          <ul className="mt-1 list-disc ps-5 text-label text-[var(--on-surface-variant)]">
            {open.map((item, i) => (
              <li key={i}>
                {shownOutstanding(item, locale, show)}
                {onViewStage && 'stageId' in item && (
                  <button
                    type="button"
                    onClick={() => onViewStage(item.stageId)}
                    className="ms-2 rounded px-1.5 py-0.5 font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                  >
                    {t('ssp.goTo', { stage: show?.stage ? show.stage(item.stageId, item.label) : item.label })}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-label text-[var(--on-surface)]">
            {t('ssp.whyFinish')}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              aria-label={t('ssp.whyFinishLabel')}
              className="mt-1 w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
            />
          </label>
        </div>
      )}
      {check && onCheck && summary.deliverableDone && (
        <div className="mt-4 rounded-lg bg-[var(--surface-container-low)] px-4 py-3">
          {check.result ? (
            <>
              <p className="text-label font-semibold text-[var(--on-surface)]">{t('ssp.against')}</p>
              <p className="mt-1 text-body text-[var(--on-surface)]">
                {t('ssp.scores', { a: check.result.alignment.score, c: check.result.clarity.score, d: check.result.drift.score })}
                {check.result.completeness?.status ? ` · ${check.result.completeness.status}` : ''}
              </p>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">
                {check.result.alignment.explanation}
              </p>
              {(check.result.interpretation?.bullets ?? []).slice(0, 3).map((b, i) => (
                <p key={i} className="mt-1 text-label text-[var(--on-surface-variant)]">
                  · {b}
                </p>
              ))}
              <p className="mt-2 text-label text-[var(--on-surface-variant)]">
                {t('ssp.recordedOnFinish')}
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-label text-[var(--on-surface-variant)]">
                {check.error ?? t('ssp.scoreFirst')}
              </p>
              <button
                onClick={onCheck}
                disabled={check.running || busy}
                className="rounded-lg bg-[var(--surface-container-high)] px-4 py-2 text-label font-semibold text-[var(--on-surface)] disabled:opacity-50"
              >
                {check.running ? t('ssp.checking') : t('ssp.checkIt')}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onConfirm(needsReason ? reason.trim() : undefined)}
          disabled={busy || (needsReason && !reason.trim())}
          className="rounded-lg bg-[var(--pm-primary)] px-5 py-2 text-title text-[var(--on-primary)] disabled:opacity-50"
        >
          {!summary.deliverableDone ? t('ssp.override') : needsReason ? t('ssp.finishAnyway') : t('ssp.finishProject')}
        </button>
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-title text-[var(--on-surface-variant)]">
          {t('pnl.notYet')}
        </button>
      </div>
    </section>
  );
}
