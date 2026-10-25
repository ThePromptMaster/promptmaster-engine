/**
 * The approvals the user has given, as every prompt reads them (25 Oct, Sean:
 * "a previous test retained approved dates and financial constraints in one
 * section, but the final blocker still claimed they were unresolved").
 *
 * A tick was stored on the project (`manual_checks`, with the version it was
 * given on in `manual_check_versions`) and shown in the checklist, but no
 * prompt was told: the final review and the objective check judged the work
 * as if nothing had been approved. Pure.
 */
import type { Project } from '@/types/project';
import type { StageArtifactBundle } from './digest';
import type { WorkflowTemplate } from './types';

export interface GivenApproval {
  stage: string;
  approval: string;
  /** The version it was given on, and the stage's current one; 0 when unknown. */
  version: number;
  current: number;
}

export function approvalsGiven(
  project: Pick<Project, 'manual_checks' | 'manual_check_versions'>,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): GivenApproval[] {
  const ticked = project.manual_checks ?? {};
  const given = project.manual_check_versions ?? {};
  const out: GivenApproval[] = [];
  for (const stage of template.stages) {
    const versions = bundles?.[stage.id]?.versions ?? [];
    const current = versions.at(-1)?.version_number ?? 0;
    for (const c of stage.exit_criteria) {
      if (c.check !== 'manual' || !ticked[c.id]) continue;
      const on = versions.find((v) => v.id === given[c.id])?.version_number ?? 0;
      out.push({ stage: stage.label, approval: c.label, version: on, current });
    }
  }
  return out.slice(0, 60);
}

/** The project with its approvals on it, for `inputsFrom`. The same object when there are none. */
export function withApprovals<P extends Project>(
  project: P,
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle> | null | undefined
): P {
  const approvals = approvalsGiven(project, template, bundles);
  return approvals.length ? { ...project, approvals } : project;
}
