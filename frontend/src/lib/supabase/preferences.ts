import { createClient } from './client';

export type Personalization = 'unset' | 'questionnaire' | 'connected' | 'declined';

export interface QuestionnaireAnswers {
  work?: string;
  need?: string;
}

export interface UserPreferences {
  personalization: Personalization;
  questionnaire: QuestionnaireAnswers;
}

/**
 * How this user chose to have work suggested (`user_preferences`). One row per
 * user, under RLS. Nothing typed is kept here, only taps.
 */
export async function loadPreferences(userId: string): Promise<UserPreferences | null> {
  const { data, error } = await createClient()
    .from('user_preferences')
    .select('personalization, questionnaire')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as UserPreferences) : null;
}

export async function savePreferences(userId: string, preferences: Partial<UserPreferences>): Promise<void> {
  const { error } = await createClient()
    .from('user_preferences')
    .upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
