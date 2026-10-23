'use client';

import { useT } from '@/lib/i18n/i18n-provider';
import { useRef, useState, type ReactNode } from 'react';

import type { RowChange } from '@/lib/workflow/row-actions';
import type { ReplyAction } from '@/types';

/**
 * What to do about a side-chat answer: a few buttons, not one per sentence.
 *
 * The answer can be as rich as it needs to be; the actions are compressed
 * (1 Oct, items 13 and 34: an explanation of why eleven works were unverified
 * came back as "Apply all 14 recommended fixes"). At most four, each one
 * decision, and "Do nothing" always among them. A change to a draft goes
 * through the same preview every other revision does; a change to a table is
 * shown row by row here and saved only on the user's click.
 */
export function ReplyActions({
  actions,
  loading,
  error,
  busy = false,
  previewRows,
  onRun,
  onDismiss,
  onRequest,
  isDone,
  afterDone,
  label,
}: {
  /** What these actions are about, for assistive technology. */
  label?: string;
  /** null: not asked for yet. */
  actions: ReplyAction[] | null;
  loading: boolean;
  error?: string | null;
  busy?: boolean;
  /** For a table action: what it would change. Empty means nothing it names can be changed. */
  previewRows?: (action: ReplyAction) => RowChange[];
  onRun: (action: ReplyAction) => Promise<void> | void;
  onDismiss: () => void;
  /** Ask for actions on a reply that has none yet (one from an earlier visit). */
  onRequest?: () => void;
  /**
   * The action has done its job — every fact it offers is on record. Its
   * button turns into a confirmation and cannot be pressed again (Sean, 14
   * Oct, SUMMIT: eight facts recorded three times).
   */
  isDone?: (action: ReplyAction) => boolean;
  /** Under a done action: what to do next. */
  afterDone?: ReactNode;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState<ReplyAction | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // A second press while the first is still saving would record twice: state
  // updates too late to stop a fast double click, a ref does not.
  const inFlight = useRef(false);
  const run = async (action: ReplyAction) => {
    if (inFlight.current || isDone?.(action)) return;
    inFlight.current = true;
    setWorking(true);
    setFailed(null);
    try {
      await onRun(action);
      setConfirming(null);
    } catch (e) {
      setFailed(e instanceof Error && e.message ? e.message : t('ra.failed'));
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };
  const anyDone = (actions ?? []).some((a) => isDone?.(a));

  const button = 'rounded-lg px-3 py-1.5 text-label transition-colors disabled:opacity-50';
  const primary = `${button} bg-[var(--pm-primary)] text-[var(--on-primary)] hover:opacity-90`;
  const quiet = `${button} bg-[var(--surface-container-highest)] text-[var(--on-surface)] hover:opacity-90`;

  if (loading) {
    return (
      <p role="status" className="text-label text-[var(--on-surface-variant)]">
        {t('ra.working')}
      </p>
    );
  }
  if (actions === null) {
    return onRequest ? (
      <button onClick={onRequest} className={quiet}>
        {t('ra.suggest')}
      </button>
    ) : null;
  }

  if (confirming?.kind === 'record_facts' && !isDone?.(confirming)) {
    // Conversation never silently becomes project state (Sean, 6 Oct, email
    // 8): what will be recorded is shown, and only "Record" writes it.
    const facts = confirming.facts ?? [];
    return (
      <section aria-label={t('ra.recordLabel')} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
        <p className="text-title text-[var(--on-surface)]">{t('ra.becomeFacts')}</p>
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">
          {t('ra.becomeFactsWhy')}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-[var(--on-surface)]">
          {facts.map((f, i) => (
            <li key={i}>
              {f.kind === 'requirement' ? <span className="font-semibold">{t('ra.requirement')}</span> : null}
              {f.subject ? `${f.subject}: ` : ''}
              {f.statement}
            </li>
          ))}
        </ul>
        {failed && (
          <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{failed}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => void run(confirming)} disabled={working || busy || !facts.length} className={primary}>
            {working ? t('ra.recording') : facts.length === 1 ? t('ra.recordThis') : t('ra.recordThese', { count: facts.length })}
          </button>
          <button onClick={() => setConfirming(null)} disabled={working} className={quiet}>
            {t('ra.back')}
          </button>
        </div>
      </section>
    );
  }

  if (confirming) {
    const changes = previewRows?.(confirming) ?? [];
    return (
      <section aria-label={t('ra.reviewLabel')} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
        <p className="text-title text-[var(--on-surface)]">{confirming.label}</p>
        {changes.length === 0 ? (
          <p className="mt-1 text-label text-[var(--on-surface-variant)]">
            {t('ra.nothingInTable')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {changes.map((c) => (
              <li key={c.id} className="text-label text-[var(--on-surface)]">
                <span className="font-semibold">{c.added ? t('ra.newRow') : c.title}</span>
                <ul className="mt-0.5 space-y-0.5 text-[var(--on-surface-variant)]">
                  {c.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{failed}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {changes.length > 0 && (
            <button onClick={() => void run(confirming)} disabled={working || busy} className={primary}>
              {working ? t('ra.saving') : t('ra.saveRows', { count: changes.length })}
            </button>
          )}
          <button onClick={() => setConfirming(null)} disabled={working} className={quiet}>
            {t('ra.back')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={label ?? t('ra.label')} className="rounded-xl bg-[var(--surface-container-low)] px-4 py-3">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">
        {actions.length ? t('ra.whatNext') : t('ra.nothingNeeded')}
      </p>
      {error && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{error}</p>}
      {failed && (
        <p role="alert" className="mt-1 text-label text-[var(--pm-error)]">{failed}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((action) =>
          isDone?.(action) ? (
            <span
              key={`${action.kind}:${action.label}`}
              role="status"
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[16px] text-[var(--pm-success)]">check_circle</span>
              {action.facts?.length === 1 ? t('ra.factRecorded') : t('ra.factsRecorded', { count: action.facts?.length ?? 0 })}
            </span>
          ) : (
          <button
            key={`${action.kind}:${action.label}`}
            onClick={() => (action.kind === 'revise' ? void run(action) : setConfirming(action))}
            disabled={working || busy}
            className={primary}
          >
            {action.label}
          </button>
          )
        )}
        <button onClick={onDismiss} disabled={working} className={quiet}>
          {t('ra.doNothing')}
        </button>
      </div>
      {anyDone && afterDone && <div className="mt-2">{afterDone}</div>}
      {actions.some((a) => a.kind === 'revise') && (
        <p className="mt-2 text-label text-[var(--on-surface-variant)]">
          {t('ra.seeFirst')}
        </p>
      )}
    </section>
  );
}
