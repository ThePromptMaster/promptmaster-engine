import { createClient } from './client';
import type { SetupDraftState } from '@/lib/projects/setup-draft';

/**
 * The user's unfinished setup (U2, 8 Oct; Sean, 7 Oct, email 14). One row per
 * user, under RLS; written as they work, deleted when the project is created.
 */

export async function loadSetupDraft(userId: string): Promise<{ data: SetupDraftState; updated_at: string } | null> {
  const { data, error } = await createClient().from('setup_drafts').select('data, updated_at').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data ? { data: data.data as SetupDraftState, updated_at: data.updated_at as string } : null;
}

export async function saveSetupDraft(userId: string, state: SetupDraftState): Promise<void> {
  const { error } = await createClient()
    .from('setup_drafts')
    .upsert({ user_id: userId, data: state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function clearSetupDraft(userId: string): Promise<void> {
  const { error } = await createClient().from('setup_drafts').delete().eq('user_id', userId);
  if (error) throw error;
}
