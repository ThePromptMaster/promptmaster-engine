/**
 * Which sign-offs can be found not to apply, and which versions still need
 * looking at (18 Nov, Sean, Executive Search: "I accept any new commitments
 * this brief proposes" on a brief that proposed none). Only the sign-off a
 * designed workflow gives for a stage's new commitments (`<stage>.decision`,
 * `lib/workflow/custom.ts`) is ever checked; every other approval stays the
 * user's. Pure.
 */

import type { StageArtifactBundle } from './digest';
import type { WorkflowEvent, WorkflowTemplate } from './types';

export interface CommitmentsToCheck {
  stageId: string;
  stageLabel: string;
  criterionId: string;
  criterion: string;
  versionId: string;
  content: string;
}

/** The commitments sign-off of a stage, when it has one. */
export function commitmentsCriterion(stage: WorkflowTemplate['stages'][number]) {
  return stage.exit_criteria.find((c) => c.check === 'manual' && c.id === `${stage.id}.decision`) ?? null;
}

/** Each stage's newest version that has a commitments sign-off and has not been looked at yet. */
export function commitmentsToCheck(
  template: WorkflowTemplate,
  bundles: Record<string, StageArtifactBundle>,
  events: readonly WorkflowEvent[],
  manualChecks: Record<string, boolean>
): CommitmentsToCheck[] {
  const seen = new Set(
    events
      .filter((e) => e.type === 'criterion_not_applicable')
      .map((e) => `${(e.payload as { criterion_id?: string } | null)?.criterion_id}@${(e.payload as { version_id?: string } | null)?.version_id}`)
  );
  const out: CommitmentsToCheck[] = [];
  for (const stage of template.stages) {
    const c = commitmentsCriterion(stage);
    const head = bundles[stage.id]?.versions.at(-1);
    if (!c || !head?.id || !head.content?.trim() || manualChecks[c.id]) continue;
    if (seen.has(`${c.id}@${head.id}`)) continue;
    out.push({ stageId: stage.id, stageLabel: stage.label, criterionId: c.id, criterion: c.label, versionId: head.id, content: head.content });
  }
  return out;
}
