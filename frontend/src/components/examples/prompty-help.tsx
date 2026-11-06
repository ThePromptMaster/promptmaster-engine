'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useBetaNoticeDismissed } from '@/components/shared/beta-notice';
import { useT } from '@/lib/i18n/i18n-provider';

/** A convenience in this browser: seen once, it stays closed until asked for. */
export const PROMPTY_STORAGE_KEY = 'pm.prompty.v1';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(PROMPTY_STORAGE_KEY) === 'seen';
  } catch {
    // Storage blocked: better closed than opening on every page.
    return true;
  }
}

function rememberSeen() {
  try {
    localStorage.setItem(PROMPTY_STORAGE_KEY, 'seen');
  } catch {
    // Not remembered; it still closes.
  }
}

/**
 * Prompty, the robot on the landing page, offering a way in (the client's call and
 * email, 4 Nov). Its words are the client's. On a first visit it opens once, after
 * the beta notice has been dealt with so the two never sit on each other; after that
 * it is a small Help button in the corner. It names no button that might not be on
 * the page, and it only links: nothing here creates or runs anything.
 *
 * The guided tour and the video are separate work, estimated and not built.
 */
export function PromptyHelp({ place, autoOpen = true }: { place: 'landing' | 'list' | 'start'; autoOpen?: boolean }) {
  const t = useT();
  const noticeDealtWith = useBetaNoticeDismissed();
  const [firstVisit] = useState(() => !alreadySeen());
  // Once pressed, the press decides; until then, whether this is a first visit.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (autoOpen && firstVisit);

  function close() {
    rememberSeen();
    setChosen(false);
  }

  if (!noticeDealtWith) return null;

  const choice = 'block rounded-lg bg-[var(--surface-container-high)] px-3 py-2 text-start text-label font-medium text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)]';

  return (
    <div className="pointer-events-none fixed bottom-2 end-2 z-40 flex flex-col items-end gap-2 sm:bottom-4 sm:end-4">
      {open && (
        <div
          role="dialog"
          aria-label={t('prompty.name')}
          className="pointer-events-auto w-[min(320px,calc(100vw-1rem))] rounded-2xl bg-[var(--surface-container-lowest)] p-4 shadow-[0_8px_32px_rgba(25,28,30,0.18)]"
        >
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-body font-medium text-[var(--on-surface)]">
              {place === 'start' ? t('prompty.start') : t('prompty.hello')}
            </p>
            <button
              type="button"
              onClick={close}
              aria-label={t('prompty.close')}
              className="shrink-0 rounded-lg p-1 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-low)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          {place === 'start' && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('prompty.startHint')}</p>}
          <div className="mt-3 flex flex-col gap-2">
            {place === 'landing' ? (
              <a href="#examples" onClick={close} className={choice}>{t('prompty.example')}</a>
            ) : (
              <Link href="/examples" onClick={close} className={choice}>{t('prompty.example')}</Link>
            )}
            {place !== 'start' && (
              <Link href="/projects/new" onClick={close} className={choice}>{t('prompty.mine')}</Link>
            )}
            <button type="button" onClick={close} className={choice}>{t('prompty.explore')}</button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => (open ? close() : setChosen(true))}
        aria-expanded={open}
        aria-label={t('prompty.help')}
        title={t('prompty.help')}
        className="pointer-events-auto block h-11 w-11 overflow-hidden rounded-full bg-[#0a0a1a] shadow-[0_4px_16px_rgba(25,28,30,0.25)] transition-transform hover:scale-105"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/prompty.png" alt="" aria-hidden className="h-full w-full object-cover" />
      </button>
    </div>
  );
}
