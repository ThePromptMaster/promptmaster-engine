/**
 * The mode a stage is worked in (13 Oct; Sean, 12.7: "Go uses Architect even
 * when Critique recommends Cold Critic … I'd expect appropriate stage
 * behavior automatically, with an override available").
 *
 * 26 Nov (Sean: "an option to choose what way to think or have PromptMaster
 * whatever it thinks best"): `stage_modes: 'stage'` is "PromptMaster chooses
 * for each step" — the stage's own recommended mode, which the workflow
 * designer now gives every designed stage — and `'project'` is one way of
 * thinking on every step, the user's pick. A stage with no mode of its own is
 * worked in the project's mode (the setup suggester's pick, or Architect). The
 * user's own persona (`custom`) is never replaced.
 */
import type { Project } from '@/types/project';
import type { StageDefinition } from './types';

type ModeProject = Pick<Project, 'mode'> & Partial<Pick<Project, 'stage_modes'>>;

export interface Thinking {
  mode: Project['mode'];
  /**
   * `step`: chosen for this stage by PromptMaster; `yours`: the user's one way
   * of thinking on every step; `default`: PromptMaster chooses, and this stage
   * has no mode of its own; `custom`: the user's own persona.
   */
  source: 'step' | 'yours' | 'default' | 'custom';
  /** Why this stage is worked in it, when the stage says. */
  reason?: string;
}

export function thinkingFor(project: ModeProject, stage: Pick<StageDefinition, 'recommended_modes'> | null | undefined): Thinking {
  if (project.mode === 'custom') return { mode: 'custom', source: 'custom' };
  if (project.stage_modes === 'project') return { mode: project.mode, source: 'yours' };
  const own = stage?.recommended_modes?.[0];
  if (own?.mode) return { mode: own.mode as Project['mode'], source: 'step', ...(own.reason ? { reason: own.reason } : {}) };
  return { mode: project.mode, source: 'default' };
}

export function modeForStage(project: ModeProject, stage: Pick<StageDefinition, 'recommended_modes'> | null | undefined): Project['mode'] {
  return thinkingFor(project, stage).mode;
}

/** Whether PromptMaster chooses the way of thinking for each step (the default). */
export function choosesPerStep(project: ModeProject): boolean {
  return project.mode !== 'custom' && project.stage_modes !== 'project';
}
