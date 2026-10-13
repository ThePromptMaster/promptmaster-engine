/**
 * The mode a stage is worked in (13 Oct; Sean, 12.7: "Go uses Architect even
 * when Critique recommends Cold Critic … I'd expect appropriate stage
 * behavior automatically, with an override available").
 *
 * A stage that recommends a mode is worked in it, unless the user keeps their
 * own mode on every stage (`stage_modes: 'project'`) or wrote their own
 * persona (`custom`), which is never replaced.
 */
import type { Project } from '@/types/project';
import type { StageDefinition } from './types';

export function modeForStage(
  project: Pick<Project, 'mode'> & Partial<Pick<Project, 'stage_modes'>>,
  stage: Pick<StageDefinition, 'recommended_modes'> | null | undefined
): Project['mode'] {
  if (project.mode === 'custom' || project.stage_modes === 'project') return project.mode;
  return (stage?.recommended_modes?.[0]?.mode as Project['mode'] | undefined) ?? project.mode;
}
