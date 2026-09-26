import type { WorkflowTemplate } from './types';

/**
 * What re-pinning a project to a newer workflow version would change.
 *
 * Published templates are immutable and projects pin the version they began
 * on, which protects a book half-way through drafting — and also stranded
 * projects on versions with since-fixed dead ends (Research v1's Experiment
 * stage). Upgrading is the user's choice, so they see this first.
 *
 * Stages are matched by id; the event log refers to stages by id, so
 * everything already recorded carries over to the stages that still exist.
 */
export interface TemplateDiff {
  added: string[];
  removed: string[];
  /** Stages present in both whose requirements or renderer changed. */
  changed: string[];
}

export function templateDiff(from: WorkflowTemplate, to: WorkflowTemplate): TemplateDiff {
  const fromIds = new Map(from.stages.map((s) => [s.id, s]));
  const toIds = new Map(to.stages.map((s) => [s.id, s]));
  const added = to.stages.filter((s) => !fromIds.has(s.id)).map((s) => s.label);
  const removed = from.stages.filter((s) => !toIds.has(s.id)).map((s) => s.label);
  const changed = to.stages
    .filter((s) => {
      const before = fromIds.get(s.id);
      if (!before) return false;
      return (
        before.renderer !== s.renderer ||
        JSON.stringify(before.exit_criteria) !== JSON.stringify(s.exit_criteria)
      );
    })
    .map((s) => s.label);
  return { added, removed, changed };
}
