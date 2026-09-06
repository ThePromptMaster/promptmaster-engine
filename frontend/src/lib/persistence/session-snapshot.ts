import { useSessionStore } from '@/stores/session-store';
import { saveSession } from '@/lib/supabase/sessions';
import type { Session } from '@/types';

/**
 * Build a Session from the current store state.
 *
 * `session_id` always comes from the store, which mints it on the first
 * iteration (session-store.ts appendIteration). Minting a fresh id here would
 * fork the user's work into a second row and orphan their chat history, which
 * keys on the store's id.
 */
export function buildSessionSnapshot(finalized?: boolean): Session | null {
  const s = useSessionStore.getState();
  if (s.iterations.length === 0) return null;

  return {
    session_id: s.sessionId ?? crypto.randomUUID().replace(/-/g, '').slice(0, 8),
    created_at: new Date().toISOString(),
    objective: s.objective,
    audience: s.audience,
    constraints: s.constraints,
    output_format: s.outputFormat,
    mode: s.mode,
    model: s.model,
    iterations: s.iterations,
    // Default to the store's flag so an autosave can never flip a finalized
    // session back to unfinalized.
    finalized: finalized ?? s.finalized,
    long_form: s.longForm,
  };
}

/**
 * Write the current session to Supabase. Safe to call often — the upsert is
 * keyed on (user_id, session_id).
 *
 * Interim autosave until the projects schema lands. Without it, a user who
 * runs iterations and closes the tab loses everything: the store persists to
 * sessionStorage, which clears on tab close.
 */
export async function flushSession(userId: string, finalized?: boolean): Promise<void> {
  const session = buildSessionSnapshot(finalized);
  if (!session) return;
  await saveSession(session, userId);
}
