/**
 * Whether a loaded workflow is the one this project pins (18 Nov, Sean's
 * Warehouse run). Opening a new project straight after another one left the
 * page, for one render, with the new project and the previous project's
 * workflow; Go's auto-start fired in that render and drafted the old
 * workflow's first stage into the new project. The page shows the workspace
 * only for a pair that fits.
 */
export function templateFitsProject(
  template: { id?: string | null; key: string } | null | undefined,
  project: { workflow_template_id?: string | null; workflow?: string | null } | null | undefined
): boolean {
  if (!template || !project) return false;
  // A pinned project fits only its pinned version.
  if (project.workflow_template_id) return template.id === project.workflow_template_id;
  // A project made before templates were pinned loads the latest of its kind.
  return !project.workflow || template.key === project.workflow;
}
