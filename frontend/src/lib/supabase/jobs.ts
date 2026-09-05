/**
 * The client's view of the job queue: read status, enqueue work, ask to pause.
 *
 * `jobs` grants the client SELECT and nothing else, deliberately — a client that
 * could set `status` or `leased_until` could starve or duplicate another tab's
 * work. So reads are ordinary queries and every write is an RPC into a
 * SECURITY DEFINER function that re-checks ownership for itself.
 */

import { createClient } from '@/lib/supabase/client';
import { DRAFT_SECTION, type DraftSectionPayload } from '@/lib/jobs/types';
import type { PMInput } from '@/types';
import type { Project } from '@/types/project';

export interface ProjectJob {
  id: string;
  kind: string;
  status: 'queued' | 'leased' | 'succeeded' | 'failed' | 'cancelled' | 'dead';
  payload: { section_id?: string; section_index?: number } | null;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

const JOB_COLUMNS =
  'id, kind, status, payload, attempts, max_attempts, error_code, error_message, created_at';

export function inputsFromProject(project: Project): PMInput {
  return {
    objective: project.objective,
    audience: project.audience,
    constraints: project.constraints,
    output_format: project.output_format,
    mode: project.mode,
    custom_name: project.custom_name,
    custom_preamble: project.custom_preamble,
    custom_tone: project.custom_tone,
    session_facts: project.session_facts,
  };
}

/**
 * The idempotency key, and the reason "completed sections are not regenerated"
 * is mechanical rather than a rule the UI has to remember.
 *
 * It names the outline version and the section revision. Enqueueing the same
 * section of the same outline twice collides and does nothing; a user-requested
 * regenerate passes the next revision and so is a genuinely different row. A
 * newly approved outline changes the version and re-drafts against it.
 */
export function sectionJobKey(
  outlineVersionId: string | null,
  sectionId: string,
  revision: number
): string {
  return `draft:${outlineVersionId ?? 'none'}:${sectionId}:${revision}`;
}

export async function listProjectJobs(projectId: string): Promise<ProjectJob[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ProjectJob[];
}

export interface EnqueueSectionArgs {
  project: Project;
  artifactId: string;
  stageId: string;
  outlineVersionId: string | null;
  sectionId: string;
  sectionIndex: number;
  /** Bumped by a user-requested regenerate; otherwise the section's own. */
  revision: number;
}

/** Returns the job id, or null when this exact unit of work already exists. */
export async function enqueueSectionJob(args: EnqueueSectionArgs): Promise<string | null> {
  const supabase = createClient();
  const payload: DraftSectionPayload = {
    project_id: args.project.id,
    artifact_id: args.artifactId,
    stage_id: args.stageId,
    section_id: args.sectionId,
    section_index: args.sectionIndex,
    outline_version_id: args.outlineVersionId,
    revision: args.revision,
    model: args.project.model,
    // Carried in the payload rather than reassembled later: the drain may run
    // hours afterwards, in a process that has never seen this user.
    inputs: inputsFromProject(args.project),
  };

  const { data, error } = await supabase.rpc('enqueue_job', {
    p_project_id: args.project.id,
    p_kind: DRAFT_SECTION,
    p_idempotency_key: sectionJobKey(args.outlineVersionId, args.sectionId, args.revision),
    p_payload: payload,
    // Earlier sections first: section N+1's prompt depends on N's record, so
    // the queue order is a correctness property.
    p_priority: -args.sectionIndex,
    p_max_attempts: 3,
    p_parent_job_id: null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/**
 * Pause. Sets the flag rather than deleting rows: a job already running
 * finishes the step it is on, because discarding prose that has been generated
 * and paid for to honour a pause is the exact failure FR-05 exists to prevent.
 */
export async function requestProjectCancel(projectId: string): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('request_project_cancel', {
    p_project_id: projectId,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
