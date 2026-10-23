import { createClient } from './client';
import { listProjectFacts } from './facts';
import { getLatestTemplate, getTemplateById } from './workflow';
import { currentFacts } from '@/lib/workflow/facts';
import { deliverableStage } from '@/lib/workflow/engine';
import { formatManuscript } from '@/lib/workflow/digest';
import { manuscriptArtifactFor } from '@/lib/workflow/context';
import { REFERENCE_MAX, type ReferenceMaterial } from '@/lib/workflow/references';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { Artifact, ProjectReference } from '@/types/project';

/**
 * The user's other projects a project draws on (client, 21 Oct, email 5).
 * The rows live in `project_references`; the material is read from the
 * referenced project under the same RLS as everything else, when the project
 * opens. Nothing is copied.
 */

const COLUMNS = 'id, project_id, user_id, referenced_project_id, include_facts, position, created_at';

export async function listReferences(projectId: string): Promise<ProjectReference[]> {
  const { data, error } = await createClient()
    .from('project_references')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectReference[];
}

export async function addReference(userId: string, projectId: string, referencedProjectId: string): Promise<ProjectReference> {
  const { data, error } = await createClient()
    .from('project_references')
    .insert({ user_id: userId, project_id: projectId, referenced_project_id: referencedProjectId })
    .select(COLUMNS)
    .single();
  if (error || !data) throw error ?? new Error('The reference could not be added.');
  return data as ProjectReference;
}

export async function removeReference(id: string): Promise<void> {
  const { error } = await createClient().from('project_references').delete().eq('id', id);
  if (error) throw error;
}

export async function setReferenceFacts(id: string, includeFacts: boolean): Promise<void> {
  const { error } = await createClient().from('project_references').update({ include_facts: includeFacts }).eq('id', id);
  if (error) throw error;
}

// Templates are immutable once published: one read per id per page.
const templates = new Map<string, Promise<WorkflowTemplate | null>>();
function templateFor(row: { workflow: string; workflow_template_id: string | null }): Promise<WorkflowTemplate | null> {
  const key = row.workflow_template_id ?? `latest:${row.workflow}`;
  if (!templates.has(key)) {
    const load = row.workflow_template_id ? getTemplateById(row.workflow_template_id) : getLatestTemplate(row.workflow);
    templates.set(key, load.catch((e) => {
      templates.delete(key);
      throw e;
    }));
  }
  return templates.get(key)!;
}

/**
 * What a reference brings: the referenced project's deliverable as it stands
 * (its head version, or the manuscript's written chapters) and its current
 * facts. Lean on purpose — a handful of reads, not the whole project.
 */
export async function loadReferenceMaterial(ref: ProjectReference): Promise<ReferenceMaterial> {
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('projects')
    .select('id, title, objective, workflow, workflow_template_id, deleted_at, updated_at')
    .eq('id', ref.referenced_project_id)
    .maybeSingle();
  if (error) throw error;
  const base: ReferenceMaterial = {
    referenceId: ref.id,
    projectId: ref.referenced_project_id,
    title: (row?.title as string) || 'Untitled project',
    objective: (row?.objective as string) ?? '',
    deliverable: '',
    text: '',
    facts: [],
    deleted: !row || Boolean(row.deleted_at),
    updatedAt: (row?.updated_at as string) ?? '',
  };
  if (base.deleted || !row) return base;

  const template = await templateFor(row as { workflow: string; workflow_template_id: string | null });
  const stage = template ? deliverableStage(template) : undefined;
  const [{ data: artifacts }, facts] = await Promise.all([
    supabase
      .from('artifacts')
      .select('id, stage_id, kind, current_version_id, long_form, summary')
      .eq('project_id', ref.referenced_project_id),
    ref.include_facts ? listProjectFacts(ref.referenced_project_id).catch(() => []) : Promise.resolve([]),
  ]);
  let text = '';
  if (template && stage) {
    const bundles = Object.fromEntries(
      ((artifacts ?? []) as unknown as Artifact[]).filter((a) => a.stage_id).map((a) => [a.stage_id!, { artifact: a, versions: [] }])
    );
    const artifact = manuscriptArtifactFor(template, stage, bundles);
    if (stage.renderer === 'long_form') {
      text = formatManuscript(artifact?.long_form?.outline ?? [], REFERENCE_MAX * 2);
    } else if (artifact?.current_version_id) {
      const { data: head } = await supabase.from('artifact_versions').select('content').eq('id', artifact.current_version_id).maybeSingle();
      text = (head?.content as string) ?? '';
    }
    if (!text.trim() && artifact?.summary) text = artifact.summary;
  }
  return {
    ...base,
    deliverable: stage?.label ?? '',
    text,
    facts: currentFacts(facts).map((f) => f.statement),
  };
}
