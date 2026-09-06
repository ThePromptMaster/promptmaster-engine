'use client';

import { useEffect } from 'react';

import { useProjectStore } from '@/stores/project-store';

/**
 * Force pending project edits out when the tab is going away.
 *
 * The store debounces scalar edits by 800ms. Unload cancels that timer, so
 * without this the last thing a user typed before closing the tab is the one
 * thing that never reaches the database — which is the exact failure the
 * session flow shipped with.
 */
export function useProjectFlush() {
  useEffect(() => {
    const flush = () => void useProjectStore.getState().flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      // Also flush on unmount — a client-side route change away from the
      // project would otherwise drop the pending patch.
      flush();
    };
  }, []);
}
