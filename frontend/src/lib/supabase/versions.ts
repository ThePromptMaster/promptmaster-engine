import { createClient } from './client';
import type { Artifact, ArtifactVersion, Evaluation } from '@/types/project';
import type { AuditFinding } from '@/types';

const ARTIFACT_COLUMNS = `
  id, user_id, project_id, kind, name, stage_id, summary, key_figures, current_version_id,
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
  interpretation, findings, further_pass_needed, further_pass_reason,
  needs_realignment, evaluator_model, source, created_at
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

/** One artifact by id, fresh — or null if it is gone. */
export async function getArtifact(id: string): Promise<Artifact | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('artifacts').select(ARTIFACT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Artifact | null) ?? null;
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

  // 23505 on artifacts_project_stage_kind_uidx: someone else created this
  // stage's artifact between our read and our insert — a second tab, or React
  // running the opening effect twice. The row we wanted exists, so return it.
  // Surfacing this as an error is what showed "Could not open the outline."
  if ((error as { code?: string } | null)?.code === '23505' && stageId) {
    const { data: existing, error: readError } = await supabase
      .from('artifacts')
      .select(ARTIFACT_COLUMNS)
      .eq('project_id', projectId)
      .eq('stage_id', stageId)
      .eq('kind', kind)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) return existing as unknown as Artifact;
  }

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

/** The figures a completed stage established, with the version they were read from. */
export async function saveArtifactFigures(
  artifactId: string,
  figures: { version_id: string; figures: { name: string; value: string; context: string }[] }
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('artifacts').update({ key_figures: figures }).eq('id', artifactId);
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
 * Append a version; the database numbers it and moves the head.
 *
 * Writes the version BEFORE updating local state (callers rely on this): a
 * failed write must not leave the UI showing a version that does not exist.
 *
 * One statement. version_number, parent_version_id and the artifact's head are
 * set by triggers under a per-artifact lock (20260927000200), so the version
 * and the head cannot disagree. This used to be numbered from the cached
 * version_count and the head moved in a second UPDATE guarded on `revision` —
 * which every artifact write bumps, the outline's draft autosave included — so
 * an outline edited and then approved was written but never became the head,
 * and every retry collided on the same number. Two tabs appending now
 * serialise into two versions; history is append-only, so nothing is lost.
 */
export async function appendVersion(
  artifact: Artifact,
  version: NewVersion
): Promise<ArtifactVersion> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('artifact_versions')
    .insert({
      user_id: artifact.user_id,
      project_id: artifact.project_id,
      artifact_id: artifact.id,
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
  return data as unknown as ArtifactVersion;
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
      // Copied forward with the scores. The content is byte-identical, so a
      // restore that kept the ratings but dropped the findings explaining them
      // would read as the defects having been fixed.
      findings: previous.findings ?? [],
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

/**
 * Whether these versions exist, and whether each holds anything. Go mode reads
 * this back after a step that claims to have saved one (1 Oct, item 4:
 * "succeeded" must mean the change is in the project).
 */
export async function checkVersions(ids: string[]): Promise<{ id: string; found: boolean; empty: boolean }[]> {
  if (!ids.length) return [];
  const supabase = createClient();
  const { data, error } = await supabase.from('artifact_versions').select('id, content').in('id', ids);
  if (error) throw error;
  const rows = new Map(((data ?? []) as { id: string; content: string | null }[]).map((r) => [r.id, r.content ?? '']));
  return ids.map((id) => ({ id, found: rows.has(id), empty: !(rows.get(id) ?? '').trim() }));
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

/**
 * Findings are optional but typed.
 *
 * `findings` is Omit-ed and added back rather than left in place because the
 * column has a default and most writers have nothing to put there — the
 * four-call iteration pipeline produces no findings at all. What changed in
 * M4.1 is the type: it was `unknown[]`, which is what a slot nothing writes
 * looks like, and a caller could not have built a valid finding against it.
 */
export type NewEvaluation = Omit<
  Evaluation,
  'id' | 'user_id' | 'project_id' | 'version_id' | 'needs_realignment' | 'created_at' | 'findings'
> & { findings?: AuditFinding[] };

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
