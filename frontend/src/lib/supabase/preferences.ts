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
