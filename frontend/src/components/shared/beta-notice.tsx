'use client';

import { useState, useSyncExternalStore } from 'react';

import { FeedbackForm } from './feedback-form';

/**
 * Versioned on purpose: bumping the suffix reissues the notice to everyone who
 * has already dismissed the previous copy.
 */
export const BETA_NOTICE_STORAGE_KEY = 'pm.beta-notice.v1';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(BETA_NOTICE_STORAGE_KEY) === 'dismissed';
  } catch {
    // Private windows throw on storage access. Showing the notice is the safe
    // failure here — it is a warning, not a preference.
    return false;
  }
}

function writeDismissed(dismissed: boolean) {
  try {
    if (dismissed) localStorage.setItem(BETA_NOTICE_STORAGE_KEY, 'dismissed');
    else localStorage.removeItem(BETA_NOTICE_STORAGE_KEY);
  } catch {
    // Nothing to do — the notice simply reappears next load.
  }
}

/**
 * The dismissal lives in localStorage, which is an external store — reading it
 * through useSyncExternalStore keeps the server render and the hydrating client
 * render agreeing (both see 'server') without a setState-in-an-effect.
 */
type NoticeState = 'server' | 'dismissed' | 'visible';

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): NoticeState {
  return readDismissed() ? 'dismissed' : 'visible';
}

function getServerSnapshot(): NoticeState {
  return 'server';
}

function setDismissedState(dismissed: boolean) {
  writeDismissed(dismissed);
  listeners.forEach((listener) => listener());
}

/**
 * FR-22: the controlled-beta notice.
 *
 * It has to say four things and it has to keep saying them: this is an early
 * beta, outputs require review, production-critical reliance is not intended,
 * and sensitive information does not belong in it. Dismissing it collapses it
 * to a chip rather than removing it — a warning a user can permanently delete
 * is a warning that was never really given, and the chip is also the way back
 * into the feedback form.
 */
export function BetaNotice() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  function dismiss() {
    setFeedbackOpen(false);
    setDismissedState(true);
  }

  function reopen() {
    setDismissedState(false);
  }

  // Nothing is rendered on the server or during hydration: the dismissal only
  // exists in this browser, so the markup would not match.
  if (state === 'server') return null;

  if (state === 'dismissed') {
    return (
      <div className="pointer-events-none fixed bottom-4 left-4 z-50">
        <button
          type="button"
          onClick={reopen}
          aria-label="Show the beta notice"
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--surface-container-high)] px-4 py-2 text-label uppercase tracking-wider text-[var(--on-surface-variant)] shadow-lg transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined text-[20px]">science</span>
          Beta
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
      <div className="pointer-events-auto w-full max-w-[760px] rounded-2xl bg-[var(--surface-container-low)] px-6 py-5 shadow-2xl">
        <div className="flex items-start gap-4">
          <span className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-[var(--on-surface-variant)]">
            science
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-title text-[var(--on-surface)]">This is an early beta</p>
            <p className="mt-1 text-body text-[var(--on-surface-variant)]">
              PromptMaster is an early beta, so outputs require review before you act on
              them — production-critical reliance is not intended, and nothing here replaces
              your own professional judgement. Please do not enter sensitive information:
              no confidential client material, personal data, or credentials.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={dismiss}
                className="rounded-xl bg-[var(--pm-primary)] px-5 py-2.5 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90"
              >
                Got it
              </button>
              <button
                type="button"
                onClick={() => setFeedbackOpen((open) => !open)}
                className="rounded-xl bg-[var(--surface-container-high)] px-5 py-2.5 text-title text-[var(--on-surface)] transition-opacity hover:opacity-90"
              >
                {feedbackOpen ? 'Hide feedback form' : 'Tell us how it went'}
              </button>
            </div>
          </div>
        </div>

        {feedbackOpen && (
          <div className="mt-5 max-h-[60vh] overflow-y-auto rounded-2xl bg-[var(--surface-container-lowest)] p-1">
            <FeedbackForm onClose={() => setFeedbackOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
