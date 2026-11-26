/**
 * What can keep moving while Go waits on the user (26 Nov, L-291). Pure.
 *
 * Sean, 25 Nov: "When PromptMaster does stop, it should tell them what decision
 * is needed, why it's theirs to make, and what can keep moving in the meantime."
 * The stop said "Nothing else can go ahead until this is decided", true of Go's
 * own next move but silent about the work: which stages are finished, current
 * and approved, ready to use as they stand, and which are still to come after
 * the one waiting.
 */
import { isDone, type WorkflowState, type WorkflowTemplate } from '@/lib/workflow/types';

export interface Meanwhile {
  /** Finished, current and not awaiting re-approval: usable as they stand, with their version. */
  ready: { stageId: string; version: number | null }[];
  /** Not finished yet and after the stage waiting: they come once it is decided. */
  waiting: string[];
}

export function meanwhile(input: {
  template: Pick<WorkflowTemplate, 'stages'>;
  state: Pick<WorkflowState, 'stages'>;
  /** The stage whose decision Go waits on. */
  stageId: string;
  /** The head version number of each stage. */
  versionOf: (stageId: string) => number | null;
  /** Stages whose approval was given on an earlier version (`reapprovalByStage`). */
  reapprove?: Readonly<Record<string, unknown>>;
}): Meanwhile {
  const order = input.template.stages.map((s) => s.id);
  const at = order.indexOf(input.stageId);
  const ready: Meanwhile['ready'] = [];
  const waiting: string[] = [];
  order.forEach((id, i) => {
    if (id === input.stageId) return;
    const status = input.state.stages[id]?.status;
    if (status && isDone(status) && status !== 'stale' && !input.reapprove?.[id]) ready.push({ stageId: id, version: input.versionOf(id) });
    else if (i > at && status !== 'skipped') waiting.push(id);
  });
  return { ready, waiting };
}
