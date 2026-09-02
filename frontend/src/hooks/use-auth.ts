'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSessionStore } from '@/stores/session-store';
import { flushSession } from '@/lib/persistence/session-snapshot';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };
    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (event === 'SIGNED_OUT') {
        useSessionStore.getState().resetSession();
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('pm-session');
        }
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, [supabase]);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
  }, [supabase]);

  const signOut = useCallback(async () => {
    // Flush before signing out — once the session is gone, RLS blocks the write
    // and any unsaved iterations are lost with the sessionStorage clear below.
    const { data: { user: current } } = await supabase.auth.getUser();
    if (current) {
      try {
        await flushSession(current.id);
      } catch {
        // Never block sign-out on a failed save.
      }
    }
    await supabase.auth.signOut();
    setUser(null);
    useSessionStore.getState().resetSession();
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('pm-session');
    }
  }, [supabase]);

  return { user, loading, signIn, signUp, signInWithGoogle, signOut };
}
