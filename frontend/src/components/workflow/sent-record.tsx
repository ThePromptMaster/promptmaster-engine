'use client';

/**
 * Which version people already received, on the stage (26 Nov, L-289).
 *
 * Sean, 25 Nov: "The user should be able to see what changed, why it changed,
 * and which version people already received." The user records it — who has
 * which version, since when, how — and after a change the stage says what has
 * moved on since: "v1 went to Bayview Grocers on 26 Nov. Current is v2, changed
 * since: …", with "Record v2 as sent" and "Keep v1 with them".
 */

import { useEffect, useState } from 'react';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { lastSent, SHARED_LIMITS, type SentBehind, type SharedRecord } from '@/lib/workflow/shared-versions';

export interface RecordInput {
  versionId: string;
  versionNumber: number;
  to: string;
  on: string;
  how?: string;
  note?: string;
  notSending?: boolean;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function SentRecord({
  head,
  records,
  behind,
  canRecord,
  onRecord,
  onUndo,
  askOpen = false,
  onAsked,
}: {
  /** The stage's current version. */
  head: { id: string; version_number: number } | null;
  /** Records still standing for this stage, oldest first. */
  records: readonly SharedRecord[];
  /** The readers have an older version than the current one. */
  behind: SentBehind | null;
  canRecord: boolean;
  onRecord: (input: RecordInput) => Promise<void>;
  onUndo: (record: SharedRecord) => Promise<void>;
  /** Open the form at once (after an export: "Sent this? Record it"). */
  askOpen?: boolean;
  onAsked?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [form, setForm] = useState<{ to: string; on: string; how: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = lastSent(records);

  useEffect(() => {
    if (askOpen && head && canRecord) {
      setForm({ to: sent?.to ?? '', on: today(), how: sent?.how ?? '', note: '' });
      onAsked?.();
    }
  }, [askOpen, head, canRecord, sent?.to, sent?.how, onAsked]);

  if (!head) return null;
  const day = (on: string) => {
    const d = new Date(`${on}T12:00:00`);
    if (!on || Number.isNaN(d.getTime())) return on;
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch {
      return on;
    }
  };
  const save = async (input: RecordInput) => {
    setBusy(true);
    setError(null);
    try {
      await onRecord(input);
      setForm(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('sent.error'));
    } finally {
      setBusy(false);
    }
  };
  const who = (r: SharedRecord) =>
    r.how ? t('sent.wentHow', { n: r.versionNumber, to: r.to, on: day(r.on), how: r.how }) : t('sent.went', { n: r.versionNumber, to: r.to, on: day(r.on) });

  const field =
    'w-full rounded-lg bg-[var(--surface-container-lowest)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40';

  return (
    // With nothing recorded yet it is one quiet line, not a panel on every stage.
    <section
      data-sent-record
      aria-label={t('sent.label')}
      className={
        !behind && !sent && !form
          ? 'mb-3 text-label text-[var(--on-surface-variant)]'
          : 'mb-4 rounded-xl bg-[var(--surface-container-low)] px-4 py-3 text-label text-[var(--on-surface-variant)]'
      }
    >
      {behind ? (
        <div data-sent-behind className="space-y-1.5">
          <p className="flex items-start gap-1.5 text-[var(--on-surface)]">
            <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-tertiary)]">{'outgoing_mail'}</span>
            <span>
              {who(behind.sent)} {t('sent.currentIs', { n: behind.current })}
            </span>
          </p>
          {behind.changes.length > 0 && (
            <ul className="list-disc ps-10">
              {/* The latest few; the timeline has every one. */}
              {behind.changes.slice(-3).map((c) => (
                <li key={c.version}>{t('sent.changedIn', { n: c.version, what: c.summary })}</li>
              ))}
            </ul>
          )}
          {canRecord && !form && (
            <div className="flex flex-wrap gap-2 ps-6">
              <button
                type="button"
                data-sent-again
                onClick={() => setForm({ to: behind.sent.to, on: today(), how: behind.sent.how ?? '', note: '' })}
                className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 font-semibold text-[var(--on-primary)] hover:opacity-90"
              >
                {t('sent.recordCurrent', { n: behind.current })}
              </button>
              <button
                type="button"
                data-sent-keep
                disabled={busy}
                onClick={() =>
                  void save({ versionId: head.id, versionNumber: head.version_number, to: behind.sent.to, on: today(), notSending: true, note: t('sent.keepNote', { n: behind.sent.versionNumber }) })
                }
                className="rounded-lg bg-[var(--surface-container-high)] px-3 py-1.5 font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] disabled:opacity-50"
              >
                {t('sent.keepOld', { n: behind.sent.versionNumber })}
              </button>
            </div>
          )}
        </div>
      ) : sent ? (
        <p data-sent-current className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden className="material-symbols-outlined text-[18px]">{'outgoing_mail'}</span>
          <span className="text-[var(--on-surface)]">{who(sent)}</span>
          {sent.note && <span>· {sent.note}</span>}
          {canRecord && (
            <button type="button" disabled={busy} onClick={() => void onUndo(sent)} className="rounded-md px-1.5 py-0.5 font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container)] disabled:opacity-50">
              {t('sent.undo')}
            </button>
          )}
        </p>
      ) : (
        canRecord &&
        !form && (
          <button
            type="button"
            data-sent-open
            onClick={() => setForm({ to: '', on: today(), how: '', note: '' })}
            className="flex items-center gap-1.5 font-semibold text-[var(--pm-primary)] hover:underline"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">{'outgoing_mail'}</span>
            {t('sent.record')}
          </button>
        )
      )}

      {form && (
        <form
          data-sent-form
          className="mt-2 grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.to.trim() || !form.on) return;
            void save({ versionId: head.id, versionNumber: head.version_number, to: form.to, on: form.on, how: form.how, note: form.note });
          }}
        >
          <p className="font-semibold text-[var(--on-surface)] sm:col-span-2">{t('sent.formTitle', { n: head.version_number })}</p>
          <label className="block">
            <span className="mb-0.5 block">{t('sent.to')}</span>
            <input value={form.to} required maxLength={SHARED_LIMITS.to} placeholder={t('sent.toHint')} onChange={(e) => setForm({ ...form, to: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-0.5 block">{t('sent.on')}</span>
            <input type="date" value={form.on} required onChange={(e) => setForm({ ...form, on: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-0.5 block">{t('sent.how')}</span>
            <input value={form.how} maxLength={SHARED_LIMITS.how} placeholder={t('sent.howHint')} onChange={(e) => setForm({ ...form, how: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-0.5 block">{t('sent.note')}</span>
            <input value={form.note} maxLength={SHARED_LIMITS.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy || !form.to.trim()} className="rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 font-semibold text-[var(--on-primary)] hover:opacity-90 disabled:opacity-50">
              {t('sent.save')}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 font-semibold text-[var(--on-surface-variant)] hover:bg-[var(--surface-container)]">
              {t('sent.cancel')}
            </button>
          </div>
          <p className="sm:col-span-2">{t('sent.yourWord')}</p>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-[var(--pm-error)]">{error}</p>}
    </section>
  );
}
