import { createClient } from './client';

export interface QuestionnaireAnswers {
  work?: string;
  need?: string;
}

/**
 * The questionnaire's taps for this user (`user_preferences`). One row per user, under
 * RLS. Nothing typed is kept here, only taps.
 */
export async function loadAnswers(userId: string): Promise<QuestionnaireAnswers | null> {
  const { data, error } = await createClient()
    .from('user_preferences')
    .select('questionnaire')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.questionnaire as QuestionnaireAnswers) : null;
}

export async function saveAnswers(userId: string, questionnaire: QuestionnaireAnswers): Promise<void> {
  const { error } = await createClient()
    .from('user_preferences')
    .upsert({ user_id: userId, questionnaire, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Whether Go starts by itself when this person makes a project (17 Nov). On unless
 * they turned it off: no row, or a failed read, is on.
 */
export async function loadGoAutostart(userId: string): Promise<boolean> {
  const { data, error } = await createClient()
    .from('user_preferences')
    .select('go_autostart')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return true;
  return (data as { go_autostart?: boolean | null }).go_autostart !== false;
}

export async function saveGoAutostart(userId: string, on: boolean): Promise<void> {
  const { error } = await createClient()
    .from('user_preferences')
    .upsert({ user_id: userId, go_autostart: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
