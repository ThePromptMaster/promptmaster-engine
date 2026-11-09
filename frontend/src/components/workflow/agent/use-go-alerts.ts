'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/i18n-provider';

/**
 * Being told when Go needs you (8 Nov). A browser alert when Go stops or
 * finishes with this tab hidden, a marker in the tab title, and the screen
 * kept on while it runs. All of it lives in the open tab: there is no service
 * worker and nothing to set up, and a phone that locks pauses the tab, which no
 * code here can change (running Go on the server is what would).
 */

const PREF_KEY = 'pm.go.alerts';

export type StopKind = 'needs_you' | 'finished';

export function stopKind(status: string | null | undefined): StopKind | null {
  switch (status) {
    case 'completed':
      return 'finished';
    case 'awaiting_decision':
    case 'blocked':
    case 'budget_exhausted':
    case 'failed':
      return 'needs_you';
    default:
      return null;
  }
}

type Permission = NotificationPermission | 'unsupported';

function permissionNow(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREF_KEY, 'on');
    else localStorage.removeItem(PREF_KEY);
  } catch {
    // A convenience; the alert just needs turning on again.
  }
}

export interface GoAlerts {
  permission: Permission;
  on: boolean;
  enable: () => Promise<void>;
  disable: () => void;
}

export function useGoAlerts({ running, status, reason, projectName }: {
  /** Go is working, including between two windows it carries on through. */
  running: boolean;
  status: string | null | undefined;
  reason: string | null | undefined;
  projectName: string;
}): GoAlerts {
  const t = useT();
  const [on, setOn] = useState(false);
  const [permission, setPermission] = useState<Permission>('default');
  useEffect(() => {
    setOn(readPref() && permissionNow() === 'granted');
    setPermission(permissionNow());
  }, []);

  const enable = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    // Asked here, on the click, as browsers require.
    const answer = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPermission(answer);
    if (answer !== 'granted') return;
    writePref(true);
    setOn(true);
  }, []);

  const disable = useCallback(() => {
    writePref(false);
    setOn(false);
  }, []);

  // The screen stays on while Go runs, and the lock is taken again on return:
  // a hidden tab loses it.
  useEffect(() => {
    if (!on || !running || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (done) void got.release().catch(() => undefined);
        else lock = got;
      } catch {
        // Refused (low battery, for one). Go carries on either way.
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [on, running]);

  // The moment Go stops: said in the tab title, and as an alert if asked for.
  const wasRunning = useRef(running);
  const titleBefore = useRef<string | null>(null);
  useEffect(() => {
    const stopped = wasRunning.current && !running;
    wasRunning.current = running;
    if (!stopped || document.visibilityState === 'visible') return;
    const kind = stopKind(status);
    if (!kind) return;
    if (titleBefore.current === null) titleBefore.current = document.title;
    document.title = t(kind === 'finished' ? 'alert.titleFinished' : 'alert.titleNeedsYou', { title: projectName });
    if (!on || permissionNow() !== 'granted') return;
    try {
      const alert = new Notification(t(kind === 'finished' ? 'alert.notifyFinished' : 'alert.notifyNeedsYou', { title: projectName }), {
        body: (reason ?? '').slice(0, 200),
        tag: 'promptmaster-go',
      });
      alert.onclick = () => {
        window.focus();
        alert.close();
      };
    } catch {
      // Some phones only allow alerts from a service worker. The tab title still says it.
    }
  }, [running, status, reason, on, projectName, t]);

  // Back on the tab: the title is the page's own again.
  useEffect(() => {
    const restore = () => {
      if (document.visibilityState !== 'visible' || titleBefore.current === null) return;
      document.title = titleBefore.current;
      titleBefore.current = null;
    };
    document.addEventListener('visibilitychange', restore);
    return () => document.removeEventListener('visibilitychange', restore);
  }, []);

  return { permission, on, enable, disable };
}
