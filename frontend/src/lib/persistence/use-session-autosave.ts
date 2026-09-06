'use client';

import { useEffect, useRef } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useAuth } from '@/hooks/use-auth';
import { flushSession } from './session-snapshot';

const DEBOUNCE_MS = 1500;

/**
 * Autosave the active session to Supabase whenever it changes.
 *
 * Mounted once in the session shell rather than wired into each of the nine
 * appendIteration call sites, so every path — the phase components, the chat
 * panel, and long-form generation — is covered by construction.
 *
 * Interim measure until projects land: today a session is only written when
 * the user reaches the Summary phase, so closing the tab mid-work discards
 * every iteration (the store persists to sessionStorage, which clears on
 * tab close).
 */
export function useSessionAutosave() {
  const { user } = useAuth();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>('');

  useEffect(() => {
    if (!user) return;
    const uid = user.id;

    const save = () => {
      const s = useSessionStore.getState();
      if (s.iterations.length === 0) return;

      // Cheap change signal — avoids rewriting an unchanged session.
      const fingerprint = [
        s.sessionId,
        s.iterations.length,
        s.finalized,
        s.longForm?.outline.filter((o) => o.status === 'complete').length ?? 0,
        s.objective,
      ].join('|');
      if (fingerprint === lastSaved.current) return;
      lastSaved.current = fingerprint;

      flushSession(uid).catch(() => {
        // Best-effort; retry happens on the next store change.
        lastSaved.current = '';
      });
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, DEBOUNCE_MS);
    };

    const unsubscribe = useSessionStore.subscribe(schedule);

    // Force a flush when the tab is being hidden or torn down — the debounce
    // would otherwise be cancelled by unload and the work lost.
    const flushNow = () => {
      if (timer.current) clearTimeout(timer.current);
      save();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushNow);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [user]);
}
