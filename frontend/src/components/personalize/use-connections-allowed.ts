'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Whether to offer connecting an account: null until known, and false if asking fails. */
export function useConnectionsAllowed(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (live) setAllowed(false);
          return;
        }
        const res = await fetch('/api/connections/allowed', { headers: { Authorization: `Bearer ${token}` } });
        if (live) setAllowed(res.ok && Boolean((await res.json())?.allowed));
      } catch {
        if (live) setAllowed(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return allowed;
}
