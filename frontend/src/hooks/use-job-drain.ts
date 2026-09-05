'use client';

/**
 * Drains this project's jobs while the tab is open, purely for latency.
 *
 * Cron already guarantees the work finishes — that is the FR-05 property, and it
 * holds with no browser involved at all. But cron ticks once a minute, and a
 * user watching sections appear should not wait up to sixty seconds between
 * them. So an open tab nudges the same endpoint on a short loop.
 *
 * Three things follow from "this is an optimisation, not the mechanism":
 *
 *   It stops when the tab is hidden. A background tab contributes nothing a
 *   cron tick will not do a moment later.
 *
 *   It does nothing on unload. There is deliberately no beacon, no
 *   `keepalive` fetch and no attempt to finish the current section — the job is
 *   leased and checkpointed, so closing the tab is already safe, and the next
 *   drain resumes it. Trying to be clever here is what the old
 *   `runAutoAdvance` loop did, and it is why closing a tab used to discard a
 *   section that had already been generated and paid for.
 *
 *   It never reports failure to the user. A drain call that fails is a missed
 *   optimisation; the error the user should see comes from the job row.
 *
 * `navigator.locks` keeps two tabs of the same project from both polling. The
 * database lease is what makes concurrent drains *safe*; the Web Lock is what
 * makes them *cheap*.
 */

import { useEffect, useRef } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Jittered so several tabs waking together do not synchronise into a spike. */
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 3_000;

/** Backoff after a failed call, so a broken deploy is not hammered. */
const ERROR_INTERVAL_MS = 15_000;

function nextDelay(): number {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

export interface UseJobDrainOptions {
  projectId: string | null | undefined;
  /**
   * Whether there is anything to drain. The caller already subscribes to the
   * project's jobs to render status, so it knows this; re-querying here would
   * duplicate that read on every tick.
   */
  hasPendingJobs: boolean;
  /** Called after each drain that did something, so the caller can refresh. */
  onProgress?: () => void;
}

export function useJobDrain({ projectId, hasPendingJobs, onProgress }: UseJobDrainOptions): void {
  // Held in refs so changing them does not tear down and restart the loop —
  // `hasPendingJobs` flips on every section, and restarting the effect each
  // time would drop the Web Lock and re-acquire it constantly.
  const pendingRef = useRef(hasPendingJobs);
  const progressRef = useRef(onProgress);
  useEffect(() => {
    pendingRef.current = hasPendingJobs;
    progressRef.current = onProgress;
  }, [hasPendingJobs, onProgress]);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    async function drainOnce(): Promise<boolean> {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return false;

      const res = await fetch('/api/jobs/drain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) return false;

      const report = (await res.json()) as { claimed?: number };
      return (report.claimed ?? 0) > 0;
    }

    async function loop(): Promise<void> {
      while (!cancelled) {
        if (document.visibilityState !== 'visible' || !pendingRef.current) {
          await sleep(nextDelay());
          continue;
        }

        try {
          const didWork = await drainOnce();
          if (cancelled) return;
          if (didWork) progressRef.current?.();
        } catch {
          // A failed nudge is not a user-visible error: cron will pick the work
          // up regardless. Back off so a broken deploy is not hammered.
          await sleep(ERROR_INTERVAL_MS);
          continue;
        }

        await sleep(nextDelay());
      }
    }

    // One drainer per project per browser, across all its tabs. Without the
    // lock, five open tabs make five times the requests to do exactly the same
    // work — the lease makes that harmless, but not free.
    const lockName = `pm-drain-${projectId}`;
    if (typeof navigator !== 'undefined' && navigator.locks) {
      navigator.locks
        .request(lockName, { mode: 'exclusive' }, async () => {
          await loop();
        })
        .catch(() => {
          // Lock aborted on unmount; nothing to do.
        });
    } else {
      // Safari before 15.4 and any non-browser environment. Correct, just
      // chattier: the database lease still prevents duplicated work.
      void loop();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId]);
}
