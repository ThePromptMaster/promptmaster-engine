import { createClient } from './client';

/**
 * FR-22 beta feedback: one row per thing a user told us during the controlled
 * beta. The four fields are the section-10 validation questions, kept as
 * columns rather than a blob so they can be read across users directly.
 */
export interface BetaFeedback {
  id: string;
  project_id: string | null;
  use_case: string;
  value: string;
  blockage: string;
  reuse_likelihood: number | null;
  created_at: string;
}

export interface NewBetaFeedback {
  use_case: string;
  value?: string;
  blockage?: string;
  /** 1 (would not use again) to 5 (would definitely use again), or null. */
  reuse_likelihood?: number | null;
  project_id?: string | null;
}

const COLUMNS = 'id, project_id, use_case, value, blockage, reuse_likelihood, created_at';

export async function submitFeedback(
  input: NewBetaFeedback,
  userId: string
): Promise<BetaFeedback> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('beta_feedback')
    .insert({
      user_id: userId,
      project_id: input.project_id ?? null,
      use_case: input.use_case,
      value: input.value ?? '',
      blockage: input.blockage ?? '',
      reuse_likelihood: input.reuse_likelihood ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as BetaFeedback;
}

export async function listMyFeedback(limit = 50): Promise<BetaFeedback[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('beta_feedback')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as BetaFeedback[];
}
