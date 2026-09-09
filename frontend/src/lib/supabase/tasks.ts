/**
 * `project_tasks` — FR-01's "unresolved tasks survive refresh, logout and
 * later login".
 *
 * Needed as its own table, as M1's schema comment says, because it cannot be
 * derived from `recommendations`: a dismissed recommendation is not an open
 * task, and a user-authored TODO has no recommendation behind it.
 *
 * ## Deferral lands here, and this is where the gap is
 *
 * `recommendations.status` has four values — pending, accepted, dismissed,
 * superseded — and no `deferred`. It must not be widened; it is contract
 * evidence for FR-02. So "Not now" leaves the recommendation **pending** and
 * writes a task, which is the honest reading: the user has not agreed and has
 * not refused, and the thing still needs doing.
 *
 * The cost, stated plainly rather than left for a reader to discover:
 * `decisions.decision_type` has no `defer_recommendation` either, so **a
 * deferral is not recorded in the append-only decision trail.** Only the task
 * row exists, and `project_tasks` is ordinary mutable user data with a delete
 * policy. Someone auditing the trail for "what did the user do about this
 * recommendation" sees nothing between the proposal and whatever happens next.
 * Closing that properly means a migration adding the decision type, which is a
 * change to contract evidence and belongs in its own reviewed commit — not a
 * CHECK constraint quietly widened to make a demo look tidier.
 */

import { createClient } from './client';

export type TaskStatus = 'open' | 'done' | 'dismissed';
export type TaskOrigin = 'user' | 'recommendation' | 'evaluation' | 'system';

export interface ProjectTask {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  detail: string;
  stage: string | null;
  status: TaskStatus;
  origin: TaskOrigin;
  origin_recommendation_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

const COLUMNS =
  'id, user_id, project_id, title, detail, stage, status, origin, ' +
  'origin_recommendation_id, created_at, resolved_at';

export async function listTasks(projectId: string): Promise<ProjectTask[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ProjectTask[];
}

export interface NewTask {
  title: string;
  detail?: string;
  stage?: string | null;
  origin?: TaskOrigin;
  origin_recommendation_id?: string | null;
}

export async function createTask(
  projectId: string,
  userId: string,
  task: NewTask
): Promise<ProjectTask> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .insert({
      project_id: projectId,
      user_id: userId,
      title: task.title,
      detail: task.detail ?? '',
      stage: task.stage ?? null,
      origin: task.origin ?? 'user',
      origin_recommendation_id: task.origin_recommendation_id ?? null,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as ProjectTask;
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<ProjectTask> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_tasks')
    .update({
      status,
      // No trigger owns this one — project_tasks is ordinary user data, not
      // audit evidence, so there is nothing here to protect from the client.
      resolved_at: status === 'open' ? null : new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as ProjectTask;
}

export function openTasks(tasks: readonly ProjectTask[]): ProjectTask[] {
  return tasks.filter((t) => t.status === 'open');
}
