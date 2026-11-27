import { createClient } from './client';

/**
 * The version a stage's artifact holds as its head now, read from the database; null when the
 * stage has none yet. An Outreach part checks it before saving (27 Nov pass: a second tab's
 * stale list of emails, saved, silently undid an approval made in the first).
 */
export async function stageHeadVersionId(projectId: string, stageId: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('artifacts')
    .select('current_version_id')
    .eq('project_id', projectId)
    .eq('stage_id', stageId)
    .maybeSingle();
  if (error) throw error;
  return (data as { current_version_id: string | null } | null)?.current_version_id ?? null;
}
