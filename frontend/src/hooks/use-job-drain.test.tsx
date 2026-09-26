import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));

import { useJobDrain } from './use-job-drain';

/**
 * An exclusive Web Lock, as the browser implements it: a second request waits
 * until the holder's callback settles, and an aborted request is withdrawn.
 */
function installLocks() {
  const queues = new Map<string, Promise<unknown>>();
  const locks = {
    request(name: string, options: { signal?: AbortSignal }, callback: () => Promise<unknown>) {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.then(() => {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return callback();
      });
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}

describe('useJobDrain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installLocks();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps draining after the component remounts (the lock is released on unmount)', async () => {
    // Starting a draft reloads the project, which remounts the renderer. The
    // first loop used to sleep forever inside the lock after its timer was
    // cleared, so the second mount never got the lock and never drained.
    const fetch = vi.fn(async () => new Response(JSON.stringify({ claimed: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    const first = renderHook(() => useJobDrain({ projectId: 'p1', hasPendingJobs: true }));
    await vi.advanceTimersByTimeAsync(10);
    first.unmount();

    const callsBefore = fetch.mock.calls.length;
    renderHook(() => useJobDrain({ projectId: 'p1', hasPendingJobs: true }));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not call the drain while there is nothing pending', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    renderHook(() => useJobDrain({ projectId: 'p1', hasPendingJobs: false }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).not.toHaveBeenCalled();
  });
});
