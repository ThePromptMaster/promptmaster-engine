import { createClient } from './client';
import type { StageDefinition, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';

interface TemplateRow {
  id: string;
  key: string;
  version: number;
  name: string;
  description: string;
  definition: {
    outline_stage: WorkflowTemplate['outline_stage'];
    derived_outline?: WorkflowTemplate['derived_outline'];
    stages: StageDefinition[];
  };
}

function toTemplate(row: TemplateRow): WorkflowTemplate & { id: string } {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    name: row.name,
    description: row.description,
    outline_stage: row.definition.outline_stage,
    derived_outline: row.definition.derived_outline,
    stages: row.definition.stages,
  };
}

const TEMPLATE_COLUMNS = 'id, key, version, name, description, definition';

/**
 * Load the exact template version a project pinned.
 *
 * Deliberately by id, not by key: a project must keep running the workflow it
 * started on even after an administrator publishes a revision, or a book
 * halfway through drafting would have its stages change underneath it.
 */
export async function getTemplateById(
  id: string
): Promise<(WorkflowTemplate & { id: string }) | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workflow_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toTemplate(data as unknown as TemplateRow) : null;
}

/** Latest published version of a template. Used when starting a new project. */
export async function getLatestTemplate(
  key: string
): Promise<(WorkflowTemplate & { id: string }) | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workflow_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('key', key)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toTemplate(data as unknown as TemplateRow) : null;
}

export async function listTemplates(): Promise<(WorkflowTemplate & { id: string })[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workflow_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('status', 'published')
    .order('key');

  if (error) throw error;
  return ((data ?? []) as unknown as TemplateRow[]).map(toTemplate);
}

// --- events -----------------------------------------------------------------

interface EventRow {
  seq: number;
  type: WorkflowEvent['type'];
  stage_id: string;
  to_stage_id: string | null;
  actor: 'user' | 'system';
  reason: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export async function listWorkflowEvents(projectId: string): Promise<WorkflowEvent[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workflow_events')
    .select('seq, type, stage_id, to_stage_id, actor, reason, payload, created_at')
    .eq('project_id', projectId)
    .order('seq', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as EventRow[]).map((r) => ({
    type: r.type,
    stage_id: r.stage_id,
    to_stage_id: r.to_stage_id ?? undefined,
    actor: r.actor,
    reason: r.reason ?? undefined,
    payload: r.payload ?? undefined,
    created_at: r.created_at,
  }));
}

export interface NewWorkflowEvent {
  type: WorkflowEvent['type'];
  stage_id: string;
  to_stage_id?: string;
  reason?: string;
  actor?: 'user' | 'system';
  payload?: Record<string, unknown>;
  /**
   * The accepted recommendation this transition acted on — FR-02's proposal
   * boundary, now on the log that is actually read.
   *
   * Set only when the user advanced by pressing Accept on a `stage_transition`
   * recommendation, which is the one path where a model's suggestion leads to
   * a state change. The database validates it: the proposal must exist, belong
   * to this user and already be `accepted`, and `actor` must be 'user'. So an
   * unaccepted proposal cannot be cited, and a citation cannot be used to dress
   * up a system-actor transition as a user decision.
   */
  proposal_id?: string | null;
}

/**
 * Append an event.
 *
 * `seq` is assigned client-side from the current count. Two tabs acting at the
 * same instant would collide on the (project_id, seq) unique index — which is
 * the correct outcome: one write fails loudly rather than two events silently
 * sharing an ordering slot. A retry picks up the new count.
 */
export async function appendWorkflowEvent(
  projectId: string,
  userId: string,
  event: NewWorkflowEvent,
  nextSeq: number
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('workflow_events').insert({
    project_id: projectId,
    user_id: userId,
    seq: nextSeq,
    type: event.type,
    stage_id: event.stage_id,
    to_stage_id: event.to_stage_id ?? null,
    actor: event.actor ?? 'user',
    reason: event.reason ?? null,
    payload: event.payload ?? {},
    proposal_id: event.proposal_id ?? null,
  });
  if (error) throw error;
}
