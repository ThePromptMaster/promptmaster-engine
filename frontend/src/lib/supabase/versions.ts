import { createClient } from './client';
import type { Artifact, ArtifactVersion, Evaluation } from '@/types/project';

const ARTIFACT_COLUMNS = `
  id, user_id, project_id, kind, name, stage_id, summary, current_version_id,
  version_count, long_form, outline_draft, revision, created_at, updated_at
`;

const VERSION_COLUMNS = `
  id, user_id, project_id, artifact_id, version_number, parent_version_id,
  source_operation, instruction, system_prompt, content, model, mode,
  change_summary, restored_from_version_id, finish_reason, user_rating,
  continuity_snapshot, created_at
`;

const EVAL_COLUMNS = `
  id, user_id, project_id, version_id,
  alignment_score, alignment_explanation, drift_score, drift_explanation,
  clarity_score, clarity_explanation, completeness_status, completeness_reason,
  interpretation, findings, needs_realignment, evaluator_model, source, created_at
`;

// --- artifacts --------------------------------------------------------------

export async function listArtifacts(projectId: string): Promise<Artifact[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('artifacts')
    .select(ARTIFACT_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as Artifact[];
}

export async function createArtifact(
  projectId: string,
  userId: string,
  kind: Artifact['kind'] = 'output',
  name = 'Output',
  stageId: string | null = null
): Promise<Artifact> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('artifacts')
    .insert({ project_id: projectId, user_id: userId, kind, name, stage_id: stageId })
    .select(ARTIFACT_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error('Failed to create artifact');
  return data as unknown as Artifact;
}

/**
 * Store what a stage concluded, so later stages can be told without being sent
 * the artifact itself. Written when a stage completes; see digest.ts.
 */
export async function saveArtifactSummary(
  artifactId: string,
  summary: string
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('artifacts')
    .update({ summary })
    .eq('id', artifactId);
  if (error) throw error;
}

/** Long-form state stays a JSONB blob on the artifact; see the M1 migration. */
export async function saveLongForm(
  artifactId: string,
  longForm: Artifact['long_form']
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('artifacts')
    .update({ long_form: longForm })
    .eq('id', artifactId);
  if (error) throw error;
}

// --- versions ---------------------------------------------------------------

export async function listVersions(artifactId: string): Promise<ArtifactVersion[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('artifact_versions')
    .select(VERSION_COLUMNS)
    .eq('artifact_id', artifactId)
    .order('version_number', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ArtifactVersion[];
}

export interface NewVersion {
  content: string;
  source_operation: string;
  instruction?: string;
  system_prompt?: string;
  model?: string;
  mode?: ArtifactVersion['mode'];
  change_summary?: string | null;
  finish_reason?: string | null;
  continuity_snapshot?: ArtifactVersion['continuity_snapshot'];
  restored_from_version_id?: string | null;
}

/**
 * Append a version and move the artifact's head pointer to it.
 *
 * Writes the version BEFORE updating local state (callers rely on this): a
 * failed write must not leave the UI showing a version that does not exist.
 *
 * Not transactional — the version insert and the head-pointer update are two
 * statements. If the second fails the version still exists and is simply not
 * yet the head, which is recoverable and visible; the reverse (a head pointing
 * at nothing) would not be.
 */
export async function appendVersion(
  artifact: Artifact,
  version: NewVersion
): Promise<ArtifactVersion> {
  const supabase = createClient();
  const nextNumber = artifact.version_count + 1;

  const { data, error } = await supabase
    .from('artifact_versions')
    .insert({
      user_id: artifact.user_id,
      project_id: artifact.project_id,
      artifact_id: artifact.id,
      version_number: nextNumber,
      parent_version_id: artifact.current_version_id,
      source_operation: version.source_operation,
      instruction: version.instruction ?? '',
      system_prompt: version.system_prompt ?? '',
      content: version.content,
      model: version.model ?? '',
      mode: version.mode ?? 'architect',
      change_summary: version.change_summary ?? null,
      finish_reason: version.finish_reason ?? null,
      continuity_snapshot: version.continuity_snapshot ?? null,
      restored_from_version_id: version.restored_from_version_id ?? null,
    })
    .select(VERSION_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error('Failed to append version');
  const created = data as unknown as ArtifactVersion;

  const { error: headError } = await supabase
    .from('artifacts')
    .update({ current_version_id: created.id, version_count: nextNumber })
    .eq('id', artifact.id)
    .eq('revision', artifact.revision);
  if (headError) throw headError;

  return created;
}

/**
 * FR-10 restore: append a new version carrying the old content, never mutate.
 *
 * Restore is undoable (restore the restore), nothing is lost, and
 * version_number stays linear — which matters because the version UI and the
 * backend's session-history formatting both assume it.
 *
 * The evaluation is copied forward rather than re-run: the content is
 * byte-identical, so a second evaluator call would cost money and could return
 * a different score for the same text, which reads to a user as a bug.
 */
export async function restoreVersion(
  artifact: Artifact,
  target: ArtifactVersion
): Promise<ArtifactVersion> {
  const created = await appendVersion(artifact, {
    content: target.content,
    source_operation: 'restore',
    instruction: `Restored version ${target.version_number}`,
    system_prompt: target.system_prompt,
    model: target.model,
    mode: target.mode,
    change_summary: `Restored version ${target.version_number}.`,
    restored_from_version_id: target.id,
  });

  const previous = await getEvaluation(target.id);
  if (previous) {
    await saveEvaluation(created, {
      alignment_score: previous.alignment_score,
      alignment_explanation: previous.alignment_explanation,
      drift_score: previous.drift_score,
      drift_explanation: previous.drift_explanation,
      clarity_score: previous.clarity_score,
      clarity_explanation: previous.clarity_explanation,
      completeness_status: previous.completeness_status,
      completeness_reason: previous.completeness_reason,
      interpretation: previous.interpretation,
      evaluator_model: previous.evaluator_model,
      source: 'restored',
    });
  }

  return created;
}

export async function rateVersion(
  versionId: string,
  rating: 'positive' | 'negative' | null
): Promise<void> {
  const supabase = createClient();
  // The only column an update may change; a database trigger rejects the rest.
  const { error } = await supabase
    .from('artifact_versions')
    .update({ user_rating: rating })
    .eq('id', versionId);
  if (error) throw error;
}

// --- evaluations ------------------------------------------------------------

export async function getEvaluation(versionId: string): Promise<Evaluation | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('evaluations')
    .select(EVAL_COLUMNS)
    .eq('version_id', versionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as Evaluation) ?? null;
}

export async function listEvaluations(projectId: string): Promise<Evaluation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('evaluations')
    .select(EVAL_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as Evaluation[];
}

export type NewEvaluation = Omit<
  Evaluation,
  'id' | 'user_id' | 'project_id' | 'version_id' | 'needs_realignment' | 'created_at' | 'findings'
> & { findings?: unknown[] };

export async function saveEvaluation(
  version: ArtifactVersion,
  evaluation: NewEvaluation
): Promise<Evaluation> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('evaluations')
    .insert({
      user_id: version.user_id,
      project_id: version.project_id,
      version_id: version.id,
      ...evaluation,
      findings: evaluation.findings ?? [],
    })
    .select(EVAL_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error('Failed to save evaluation');
  return data as unknown as Evaluation;
}
