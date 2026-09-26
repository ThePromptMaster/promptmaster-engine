import { createClient } from './client';
import type { Session, SessionSummary } from '@/types';

export async function listSessions(limit = 20): Promise<SessionSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('session_id, objective, mode, iterations, created_at, finalized')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  // `objective` is nullable in the table; the summary is not.
  type Row = Omit<SessionSummary, 'objective'> & { objective: string | null };
  return ((data ?? []) as Row[]).map((s) => ({
    session_id: s.session_id,
    objective: s.objective?.slice(0, 80) ?? '',
    mode: s.mode,
    iterations: s.iterations,
    created_at: s.created_at,
    finalized: s.finalized,
  }));
}

export async function loadSession(sessionId: string): Promise<Session | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('data')
    .eq('session_id', sessionId)
    .single();

  if (error || !data) return null;
  return data.data as Session;
}

export async function saveSession(session: Session, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('sessions')
    .upsert({
      user_id: userId,
      session_id: session.session_id,
      objective: session.objective.slice(0, 500),
      mode: session.mode,
      audience: session.audience,
      iterations: session.iterations.length,
      finalized: session.finalized,
      data: session,
    }, { onConflict: 'user_id,session_id' });

  if (error) throw error;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('session_id', sessionId);

  if (error) throw error;
}
