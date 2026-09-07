'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useProjectStore } from '@/stores/project-store';
import type { User } from '@supabase/supabase-js';

/**
 * Drop whatever the signed-out user was looking at.
 *
 * This used to reset the session store and clear its `pm-session`
 * sessionStorage key. Neither exists now: project state lives in Supabase
 * under RLS, and the store holds a cache of one project. Flushing first
 * matters for the same reason it always did — once the session is gone RLS
 * refuses the write, so a debounced edit that has not left the browser yet is
 * lost with it.
 */
async function releaseOpenProject() {
  const store = useProjectStore.getState();
  try {
    await store.flush();
  } catch {
    // Never block sign-out on a failed save.
  }
  store.closeProject();
}

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
        useProjectStore.getState().closeProject();
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

  /**
   * Start using the app without an account.
   *
   * Supabase issues a real auth.users row for an anonymous user, so RLS, row
   * ownership and every foreign key work unchanged — the only difference is
   * that the identity has no email attached yet. supabase-js keeps the session
   * in browser storage, so the work survives reloads on this browser.
   *
   * Requires the project's anonymous provider to be enabled; the caller gets a
   * recognisable error if it is not.
   */
  const continueAsGuest = useCallback(async () => {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }, [supabase]);

  /**
   * Turn the current anonymous account into a permanent one, keeping every
   * project already created. Supabase updates the existing user in place
   * rather than creating a second one, so nothing has to be migrated.
   */
  const createAccountFromGuest = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.updateUser({ email, password });
      if (error) throw error;
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    await releaseOpenProject();
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  // Supabase marks guest identities with is_anonymous on the JWT.
  const isGuest = Boolean(user?.is_anonymous);

  return {
    user,
    loading,
    isGuest,
    signIn,
    signUp,
    signInWithGoogle,
    continueAsGuest,
    createAccountFromGuest,
    signOut,
  };
}
