import { createClient } from './client';
import { getProject } from './projects';
import { listArtifacts } from './versions';
import { getLatestTemplate, getTemplateById, listWorkflowEvents } from './workflow';
import { projectState } from '@/lib/workflow/engine';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';
import type { ArtifactVersion, Project } from '@/types/project';

export interface ProjectForReading {
  project: Project;
  template: WorkflowTemplate;
  state: WorkflowState;
  /** Each stage's artifact with only its head version. */
  bundles: Record<string, StageArtifactBundle>;
}

/**
 * Another project, read for the split view (client feedback, 21 Oct, email 4).
 * Read-only and its own: nothing here goes near the open project's store, and
 * only each stage's head version is read, not its history. Null for a project
 * that is gone or in the trash.
 */
export async function loadProjectForReading(id: string): Promise<ProjectForReading | null> {
  const project = await getProject(id);
  if (!project || project.deleted_at) return null;
  const [template, artifacts, events] = await Promise.all([
    project.workflow_template_id ? getTemplateById(project.workflow_template_id) : getLatestTemplate(project.workflow),
    listArtifacts(id),
    listWorkflowEvents(id),
  ]);
  if (!template) return null;

  const headIds = artifacts.map((a) => a.current_version_id).filter((v): v is string => Boolean(v));
  const heads = new Map<string, ArtifactVersion>();
  if (headIds.length) {
    const { data, error } = await createClient().from('artifact_versions').select('*').in('id', headIds);
    if (error) throw error;
    for (const v of (data ?? []) as ArtifactVersion[]) heads.set(v.id, v);
  }
  const bundles: Record<string, StageArtifactBundle> = {};
  for (const a of artifacts) {
    if (!a.stage_id) continue;
    const head = a.current_version_id ? heads.get(a.current_version_id) : undefined;
    bundles[a.stage_id] = { artifact: a, versions: head ? [head] : [] };
  }
  return { project, template, state: projectState(template, events, project.stage), bundles };
}
