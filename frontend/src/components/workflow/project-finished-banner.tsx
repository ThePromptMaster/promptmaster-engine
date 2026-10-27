'use client';

import Link from 'next/link';

import { useT } from '@/lib/i18n/i18n-provider';

interface Props {
  onReopen: () => void;
  /** Stages moved past with requirements still open. They can be closed from here. */
  leftOpen?: { id: string; label: string }[];
  onViewStage?: (stageId: string) => void;
  /** Finished early: what was not done yet, each with the stage to go back to (26 Oct). */
  notDone?: { text: string; stageId?: string }[];
  /** Reopen the project on that stage. */
  onGoBack?: (stageId: string) => void;
}

/**
 * Shown in place of the transition bar once the project is finished (PM-03).
 *
 * Finishing used to change nothing visible, so the button looked broken. Now
 * the project says it is done, says where it went, and offers the way back —
 * finishing is a status, not a lock, and everything stays readable.
 */
export function ProjectFinishedBanner({ onReopen, leftOpen = [], onViewStage, notDone, onGoBack }: Props) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-container-low)] px-5 py-4"
    >
      <span aria-hidden className="material-symbols-outlined text-[var(--pm-primary)]">
        task_alt
      </span>
      <div className="me-auto">
        <p className="text-title text-[var(--on-surface)]">{t('pnl.finished')}</p>
        <p className="text-label text-[var(--on-surface-variant)]">
          {t('pnl.finishedNote')}
        </p>
        {notDone && notDone.length > 0 && (
          <div role="group" aria-label={t('early.caveats')} className="mt-2">
            <p className="text-label font-semibold text-[var(--on-surface)]">{t('early.bannerTitle')}</p>
            <ul className="mt-1 list-disc ps-5 text-label text-[var(--on-surface-variant)]">
              {notDone.map((item, i) => (
                <li key={i}>
                  {item.text}
                  {onGoBack && item.stageId && (
                    <button
                      type="button"
                      onClick={() => onGoBack(item.stageId!)}
                      className="ms-2 rounded px-1.5 py-0.5 font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                    >
                      {t('early.goBack')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {leftOpen.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-label text-[var(--on-surface-variant)]">
            <span>{t('pnl.leftOpen', { stages: leftOpen.map((s) => s.label).join(', ') })}</span>
            {onViewStage &&
              leftOpen.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onViewStage(s.id)}
                  className="rounded px-1.5 py-0.5 text-label font-semibold text-[var(--pm-primary)] hover:bg-[var(--surface-container-high)]"
                >
                  {t('pnl.closeStage', { stage: s.label })}
                </button>
              ))}
          </p>
        )}
      </div>
      <div className="flex gap-2">
      <Link
        href="/projects"
        className="rounded-lg px-3 py-2 text-title text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)] hover:text-[var(--on-surface)]"
      >
        {t('pnl.allProjects')}
      </Link>
      <button
        onClick={onReopen}
        className="rounded-lg bg-[var(--surface-container-highest)] px-4 py-2 text-title text-[var(--on-surface)] hover:opacity-90"
      >
        {t('pnl.reopen')}
      </button>
      </div>
    </div>
  );
}
