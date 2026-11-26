'use client';

/**
 * "Since your last visit" (26 Nov, L-290). Sean, 25 Nov: "At change 30, can they
 * pick up where they left off without repeating facts, finding stale
 * recommendations themselves, or checking every deliverable by hand?"
 *
 * On opening a project in this browser, every change since the viewer was last
 * here: what each one replaced and reopened, what was redone (by whom, to which
 * version), what was checked and kept, and what was recorded as sent; then the
 * work as it stands now (`ChangeGroups`). "Got it" moves the marker to now.
 */

import { useEffect, useMemo, useState } from 'react';

import { useLocale, useT } from '@/lib/i18n/i18n-provider';
import { readLastSeen, writeLastSeen } from '@/lib/projects/last-seen';
import type { ChangeSummary } from '@/lib/workflow/change-summary';
import { anythingSince, changesSince } from '@/lib/workflow/since-summary';
import type { WorkflowEvent } from '@/lib/workflow/types';
import { ChangeGroups } from './brief-change-notice';

export function SinceLastVisit({
  projectId,
  events,
  stageLabel,
  summarise,
  onOpenStage,
  latestChangeShown,
}: {
  projectId: string;
  events: readonly WorkflowEvent[];
  stageLabel: (id: string) => string;
  /** The work as it stands, from `since` over the stages these changes touched. */
  summarise: (since: string, touched: string[]) => ChangeSummary | null;
  onOpenStage?: (stageId: string) => void;
  /** The change notice already shows the latest change: a single change is left to it. */
  latestChangeShown: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  // Read once, on opening: the marker moves when the viewer leaves, not while they read.
  const [since] = useState(() => readLastSeen(projectId));
  const [range, setRange] = useState<'visit' | 'all'>('visit');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const leave = () => writeLastSeen(projectId);
    const onHide = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onHide);
      leave();
    };
  }, [projectId]);

  const fromVisit = useMemo(() => (since ? changesSince(events, since) : null), [events, since]);
  const shown = useMemo(() => (range === 'all' ? changesSince(events, '') : fromVisit), [range, events, fromVisit]);
  const start = range === 'all' ? '' : since ?? '';
  const now = useMemo(() => (shown && shown.touched.length ? summarise(start, shown.touched) : null), [shown, start, summarise]);

  if (dismissed || !since || !fromVisit || !anythingSince(fromVisit) || !shown) return null;
  if (range === 'visit' && latestChangeShown && fromVisit.changes.length <= 1) return null;

  const when = (at: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
    } catch {
      return at.slice(0, 16).replace('T', ' ');
    }
  };

  return (
    <section data-since-last-visit aria-label={t('slv.label')} className="mb-4 rounded-xl bg-[var(--surface-container-low)] px-4 py-3 text-label text-[var(--on-surface-variant)]">
      <p className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="material-symbols-outlined text-[18px] text-[var(--pm-primary)]">{'history'}</span>
        <span className="me-auto font-semibold text-[var(--on-surface)]">
          {range === 'all' ? t('slv.titleAll') : t('slv.title', { when: when(since) })}
        </span>
        <button type="button" data-slv-range onClick={() => setRange(range === 'all' ? 'visit' : 'all')} className="rounded-md px-1.5 py-0.5 font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container)]">
          {range === 'all' ? t('slv.sinceVisit') : t('slv.all')}
        </button>
        <button
          type="button"
          data-slv-done
          onClick={() => {
            writeLastSeen(projectId);
            setDismissed(true);
          }}
          className="rounded-lg bg-[var(--surface-container-high)] px-2.5 py-1 font-semibold text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)]"
        >
          {t('slv.gotIt')}
        </button>
      </p>

      {shown.changes.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {shown.changes.map((c) => (
            <li key={c.at} className="rounded-lg bg-[var(--surface-container)] px-2.5 py-1.5">
              <p className="text-[var(--on-surface)]">
                {when(c.at)} · {c.field === 'facts' ? t('slv.facts') : t('slv.brief')}
              </p>
              {c.detail.pairs.map((p, i) => (
                <p key={`p${i}`}>
                  {t('slv.pair', { from: p.from, to: p.to })}
                </p>
              ))}
              {c.detail.removed.map((r, i) => <p key={`r${i}`}>{t('slv.removed', { what: r })}</p>)}
              {c.detail.added.map((a, i) => <p key={`a${i}`}>{t('slv.added', { what: a })}</p>)}
              {c.detail.reopened.length > 0 && <p>{t('slv.reopened', { list: c.detail.reopened.map((r) => stageLabel(r.stageId)).join(', ') })}</p>}
              {c.detail.setAside.length > 0 && <p>{t('slv.setAside', { list: c.detail.setAside.join('; ') })}</p>}
            </li>
          ))}
        </ul>
      )}
      {shown.redone.length > 0 && (
        <p className="mt-2">
          <span className="font-semibold text-[var(--on-surface)]">{t('slv.redone')}</span>{' '}
          {shown.redone.map((r) => t(r.by === 'go' ? 'slv.byGo' : 'slv.byYou', { stage: stageLabel(r.stageId), n: r.version })).join(' · ')}
        </p>
      )}
      {shown.kept.length > 0 && (
        <p className="mt-1">
          <span className="font-semibold text-[var(--on-surface)]">{t('slv.kept')}</span> {shown.kept.map(stageLabel).join(', ')}
        </p>
      )}
      {shown.sent.length > 0 && (
        <p className="mt-1">
          <span className="font-semibold text-[var(--on-surface)]">{t('slv.sent')}</span>{' '}
          {shown.sent.map((s) => t('slv.sentLine', { stage: stageLabel(s.stageId), n: s.version, to: s.to })).join(' · ')}
        </p>
      )}
      {shown.finished && <p className="mt-1">{t('slv.finished')}</p>}
      {now && (
        <div className="mt-2">
          <p className="font-semibold text-[var(--on-surface)]">{t('slv.now')}</p>
          <ChangeGroups summary={now} stageLabel={stageLabel} onOpenStage={onOpenStage} settled={false} />
        </div>
      )}
    </section>
  );
}
