/**
 * Which earlier stage's new version reopened a stage (17 Nov). Pure.
 *
 * A save on any stage reopens every finished stage after it, whatever each one
 * reads (`laterDoneStages`), and a reopened stage was always rewritten whole.
 * Sean (17 Nov): "a small change [should] get a quick check of the two drafts it
 * affects". So before rewriting, the recheck looks at what changed in that
 * earlier stage, and asks one small question (`assess-change`): did this stage
 * rely on it? If not, the stage is kept as it is and closed again.
 */

import type { WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';

export interface UpstreamChange {
  stageId: string;
  label: string;
  /** The version this stage was built on, and the one it is now. */
  beforeId: string;
  afterId: string;
  beforeNumber: number | null;
  afterNumber: number | null;
}

/**
 * The single earlier stage whose saves since `since` reopened `targetId`, with
 * the version before the first save and after the last. Null when it was
 * reopened some other way (a brief change, a completion on other evidence) or
 * by more than one stage: those are rewritten as before.
 */
export function upstreamChange(
  template: WorkflowTemplate,
  events: readonly WorkflowEvent[],
  targetId: string,
  since: string
): UpstreamChange | null {
  const order = template.stages.map((s) => s.id);
  const at = order.indexOf(targetId);
  if (at < 0) return null;
  const saves = events.filter((e) => {
    if (e.type !== 'stage_version_saved' || e.created_at < since) return false;
    const from = order.indexOf(e.stage_id);
    if (from < 0 || from >= at) return false;
    const affected = e.payload?.affected;
    return Array.isArray(affected) ? affected.includes(targetId) : true;
  });
  if (!saves.length) return null;
  if (new Set(saves.map((e) => e.stage_id)).size > 1) return null;
  const first = saves[0];
  const last = saves[saves.length - 1];
  const beforeId = typeof first.payload?.prior_version_id === 'string' ? first.payload.prior_version_id : null;
  const afterId = typeof last.payload?.version_id === 'string' ? last.payload.version_id : null;
  if (!beforeId || !afterId || beforeId === afterId) return null;
  const n = (e: WorkflowEvent) => (typeof e.payload?.version_number === 'number' ? (e.payload.version_number as number) : null);
  const afterNumber = n(last);
  const beforeNumber = afterNumber === null ? null : Math.max(1, (n(first) ?? afterNumber) - 1);
  return {
    stageId: first.stage_id,
    label: template.stages[order.indexOf(first.stage_id)]?.label ?? first.stage_id,
    beforeId,
    afterId,
    beforeNumber,
    afterNumber,
  };
}
