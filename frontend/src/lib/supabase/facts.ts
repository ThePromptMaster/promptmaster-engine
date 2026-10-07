import { createClient } from './client';
import type { ProjectFact } from '@/types/project';

/**
 * The project's accepted facts and requirements (F1, 7 Oct; Sean, 6 Oct:
 * "Accepted evidence is recorded once with its source and provenance").
 *
 * Append-only: a fact is recorded, superseded by a new one, or retired —
 * never edited (the table's trigger refuses anything else). The browser writes
 * under RLS; the backend owns no data and is sent the current facts with
 * every request (`inputsFrom`).
 */

const COLUMNS =
  'id, project_id, user_id, statement, subject, kind, source_kind, source_ref, accepted_by, agent_run_id, supersedes, retired_at, retired_reason, created_at';

export interface NewFact {
  statement: string;
  subject?: string | null;
  kind?: ProjectFact['kind'];
  source_kind: ProjectFact['source_kind'];
  source_ref?: Record<string, unknown>;
}

export async function listProjectFacts(projectId: string): Promise<ProjectFact[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_facts').select(COLUMNS).eq('project_id', projectId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectFact[];
}

/** Record facts the user accepted, in one insert. */
export async function recordFacts(project: { id: string; user_id: string }, facts: readonly NewFact[]): Promise<ProjectFact[]> {
  if (!facts.length) return [];
  const supabase = createClient();
  const rows = facts.map((f) => ({
    project_id: project.id,
    user_id: project.user_id,
    statement: f.statement.trim(),
    subject: f.subject?.trim() || null,
    kind: f.kind ?? 'fact',
    source_kind: f.source_kind,
    source_ref: f.source_ref ?? {},
  }));
  const { data, error } = await supabase.from('project_facts').insert(rows).select(COLUMNS);
  if (error) throw error;
  return (data ?? []) as unknown as ProjectFact[];
}

/** Change a fact: a new row that supersedes it; the database retires the old one in the same insert. */
export async function supersedeFact(
  project: { id: string; user_id: string },
  old: Pick<ProjectFact, 'id' | 'kind' | 'subject'>,
  statement: string
): Promise<ProjectFact> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_facts')
    .insert({
      project_id: project.id, user_id: project.user_id, statement: statement.trim(), subject: old.subject,
      kind: old.kind, source_kind: 'user_edit', source_ref: { supersedes: old.id }, supersedes: old.id,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as ProjectFact;
}

/** Take a fact out of the current record; it stays in the history. */
export async function retireFact(id: string, reason: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('project_facts')
    .update({ retired_at: new Date().toISOString(), retired_reason: reason.slice(0, 500) || 'retired' })
    .eq('id', id);
  if (error) throw error;
}
