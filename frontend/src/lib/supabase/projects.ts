import { createClient } from './client';
import {
  ProjectConflictError,
  type Project,
  type ProjectInput,
  type ProjectPatch,
  type ProjectSummary,
} from '@/types/project';

const LIST_COLUMNS =
  'id, title, objective, mode, workflow, stage, status, updated_at, created_at';

const FULL_COLUMNS = `
  id, user_id, title, objective, audience, constraints, output_format,
  mode, custom_name, custom_preamble, custom_tone,
  model, session_facts, active_stack_id, constraint_presets, format_presets,
  workflow, workflow_template_id, stage, status, manual_checks, revision,
  archived_at, deleted_at, legacy_session_id, created_at, updated_at
`;

export async function listProjects(limit = 50): Promise<ProjectSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(LIST_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as ProjectSummary[];
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .select(FULL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as Project) ?? null;
}

export async function createProject(
  input: ProjectInput,
  userId: string
): Promise<Project> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      title: input.title?.trim() || 'Untitled project',
      objective: input.objective ?? '',
      audience: input.audience ?? 'General',
      constraints: input.constraints ?? '',
      output_format: input.output_format ?? '',
      mode: input.mode ?? 'architect',
      model: input.model ?? '',
      workflow: input.workflow ?? 'single_output',
    })
    .select(FULL_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error('Failed to create project');
  return data as unknown as Project;
}

/**
 * Patch a project, refusing the write if someone else changed it first.
 *
 * `revision` is bumped by a database trigger, so it is never part of the
 * payload — a client that could set it would just echo its stale value back and
 * the guard would pass.
 *
 * Throws ProjectConflictError rather than returning a flag, so a caller cannot
 * accidentally ignore a lost update.
 */
export async function updateProject(
  id: string,
  patch: ProjectPatch,
  knownRevision: number
): Promise<Project> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('projects')
    .update(patch)
    .eq('id', id)
    .eq('revision', knownRevision)
    .select(FULL_COLUMNS)
    .maybeSingle();

  if (error) throw error;
  if (data) return data as unknown as Project;

  // Zero rows is ambiguous under RLS: stale revision, row invisible, or row
  // deleted. Re-read to tell them apart — reporting "someone else edited this"
  // for a deleted project trains users to click Overwrite.
  const current = await getProject(id);
  throw new ProjectConflictError(current ? 'stale' : 'deleted', current);
}

/**
 * FR-20: recoverable by default. A hard delete of someone's book manuscript
 * with no undo is the wrong default, so this sets deleted_at and a scheduled
 * job removes the row later.
 */
export async function softDeleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function restoreProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) throw error;
}

/** Permanent. Cascades to artifacts, versions and evaluations. */
export async function hardDeleteProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}
