'use client';

import { useState } from 'react';

import { entryHoldsUp, type QueueEntry, type QueueItem } from '@/lib/agent/user-queue';
import { useT } from '@/lib/i18n/i18n-provider';
import type { DecisionOffer } from '@/lib/workflow/decision-options';

/** What the user did with one entry of the list. */
export type QueueAnswer =
  | { kind: 'approve' }
  | { kind: 'choose'; choice: string }
  | { kind: 'accept' }
  | { kind: 'reject'; reason?: string }
  | { kind: 'settle' }
  | { kind: 'answer'; text: string };

/**
 * Everything else in the project that is waiting on the user, under the stop
 * Go has just made (12 Nov; a client: "If one answer clears three blockers, Go
 * should ask once, apply the answer everywhere it matters, and keep going").
 *
 * Each of these used to be a stop of its own, later. Answered here, it is
 * recorded the way it would have been at its own stop — an approval given, a
 * finding decided, a question's answer saved as a fact — and the run does not
 * stop for it again. Items one answer settles are asked as one question.
 * Nothing here resumes Go: the stop above does that.
 */
export function QuestionQueue({
  entries,
  offers = {},
  onAnswer,
}: {
  entries: readonly QueueEntry[];
  /** The options a reserved approval offers, by criterion id. */
  offers?: Record<string, DecisionOffer>;
  /** Resolves with the items the answer was recorded for and did not settle, when there are any. */
  onAnswer: (entry: QueueEntry, answer: QueueAnswer) => Promise<{ open: QueueItem[] } | void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  /** What the last answer left open: it was recorded, and those still wait. */
  const [stillOpen, setStillOpen] = useState<QueueItem[]>([]);
  if (!entries.length) return null;

  const send = (entry: QueueEntry, answer: QueueAnswer) => {
    if (busy) return;
    setBusy(entry.key);
    setFailed(null);
    setStillOpen([]);
    onAnswer(entry, answer)
      .then((result) => {
        setText((prev) => ({ ...prev, [entry.key]: '' }));
        setStillOpen(result?.open ?? []);
      })
      .catch((e: unknown) => setFailed({ key: entry.key, message: e instanceof Error && e.message ? e.message : t('nyc.failed') }))
      .finally(() => setBusy(null));
  };

  const what = (item: QueueItem) =>
    item.kind === 'approval' ? t('qq.kindApproval', { stage: item.stageLabel })
      : item.kind === 'finding' ? t('qq.kindFinding', { id: item.rowId ?? '', stage: item.stageLabel })
      : item.kind === 'carried' ? t('qq.kindCarried', { id: item.rowId ?? '', stage: item.stageLabel })
      : t('qq.kindKept', { stage: item.stageLabel });

  const primary = 'rounded-lg bg-[var(--pm-primary)] px-3 py-1.5 text-start text-label font-semibold text-[var(--on-primary)] disabled:opacity-50';
  const secondary = 'rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-start text-label font-semibold text-[var(--on-surface)] disabled:opacity-50';

  return (
    <section aria-label={t('qq.heading')} data-question-queue className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4">
      <p className="text-label uppercase tracking-wide text-[var(--on-surface-variant)]">{t('qq.heading')}</p>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('qq.lead')}</p>
      {stillOpen.length > 0 && (
        <p role="status" data-queue-still-open className="mt-2 text-label text-[var(--on-surface)]">
          {t('qq.stillOpen', { list: stillOpen.map(what).join('; ') })}
        </p>
      )}
      <ol className="mt-3 space-y-4">
        {entries.map((entry, n) => {
          const first = entry.items[0];
          const single = entry.items.length === 1;
          const typed = (text[entry.key] ?? '').trim();
          const waiting = busy !== null;
          const holds = entryHoldsUp(entry);
          const offer = single && first.kind === 'approval' && first.criterionId ? offers[first.criterionId] : undefined;
          const options = offer && !offer.loading ? offer.options : [];
          // What can be said in words: a decision on an approval that offers options, a carried row, a kept question.
          const takesWords = !single || first.kind === 'carried' || first.kind === 'kept_question' || (first.kind === 'approval' && options.length > 0) || first.kind === 'finding';
          return (
            <li key={entry.key} data-queue-entry={entry.key} className="rounded-lg bg-[var(--surface-container-lowest)] px-4 py-3">
              <p className="text-label text-[var(--on-surface-variant)]">
                {n + 1}. {single ? what(first) : t('qq.merged', { count: entry.items.length, list: entry.items.map(what).join('; ') })}
                {holds ? ` · ${t('qq.holdsUp', { what: holds })}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-line text-body text-[var(--on-surface)]">{entry.question ?? first.text}</p>
              {single && first.note && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('qq.note', { note: first.note })}</p>}
              {offer?.loading && <p className="mt-2 text-label text-[var(--on-surface-variant)]">{t('nyc.optionsLoading')}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {single && first.kind === 'approval' && options.map((o) => (
                  <button key={o.label} type="button" title={o.quote} disabled={waiting} onClick={() => send(entry, { kind: 'choose', choice: o.label })} className={primary}>
                    {o.label}
                  </button>
                ))}
                {single && first.kind === 'approval' && !offer?.loading && options.length === 0 && (
                  <button type="button" disabled={waiting} onClick={() => send(entry, { kind: 'approve' })} className={primary}>
                    {t('qq.approve')}
                  </button>
                )}
                {single && first.kind === 'finding' && (
                  <>
                    <button type="button" disabled={waiting} onClick={() => send(entry, { kind: 'accept' })} className={primary}>{t('qq.accept')}</button>
                    <button type="button" disabled={waiting} onClick={() => send(entry, { kind: 'reject', ...(typed ? { reason: typed } : {}) })} className={secondary}>{t('qq.reject')}</button>
                  </>
                )}
                {single && first.kind === 'carried' && (
                  <button type="button" disabled={waiting} onClick={() => send(entry, { kind: 'settle' })} className={secondary}>{t('qq.settled')}</button>
                )}
                {(!single || first.kind === 'kept_question') && (entry.choices ?? []).map((c) => (
                  <button key={c} type="button" disabled={waiting} onClick={() => send(entry, { kind: 'answer', text: c })} className={primary}>
                    {c}
                  </button>
                ))}
              </div>
              {takesWords && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="text-label text-[var(--on-surface-variant)]">
                      {single && first.kind === 'finding' ? t('qq.rejectWhy') : single && first.kind === 'approval' ? t('nyc.somethingElse') : t('qq.answerLabel')}
                    </span>
                    <textarea
                      value={text[entry.key] ?? ''}
                      onChange={(e) => setText((prev) => ({ ...prev, [entry.key]: e.target.value }))}
                      disabled={waiting}
                      rows={1}
                      maxLength={600}
                      className="mt-1 w-full rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] disabled:opacity-50"
                    />
                  </label>
                  {!(single && first.kind === 'finding') && (
                    <button
                      type="button"
                      disabled={waiting || !typed}
                      onClick={() => send(entry, single && first.kind === 'approval' ? { kind: 'choose', choice: typed } : { kind: 'answer', text: typed })}
                      className={secondary}
                    >
                      {busy === entry.key ? t('nyc.working') : t('qq.answer')}
                    </button>
                  )}
                </div>
              )}
              {failed?.key === entry.key && <p role="alert" className="mt-2 text-label text-[var(--pm-tertiary)]">{failed.message}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
