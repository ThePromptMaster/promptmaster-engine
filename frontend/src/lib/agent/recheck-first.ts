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
 * the version before the first and after the last. Two kinds of event reopen a
 * later stage this way: a new version saved (`stage_version_saved`) and the
 * stage marked complete again on a different version (`stage_marked_complete`
 * with other evidence). Null when it was reopened some other way (a brief
 * change) or by more than one stage: those are rewritten as before.
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
  const earlier = (e: WorkflowEvent) => {
    const from = order.indexOf(e.stage_id);
    return from >= 0 && from < at;
  };
  const evidenceOf = (e: WorkflowEvent) => (typeof e.payload?.evidence_version_id === 'string' ? (e.payload.evidence_version_id as string) : null);
  // Each change as [before, after] version ids, in order.
  const changes: { stageId: string; before: string | null; after: string | null; n: number | null }[] = [];
  events.forEach((e, i) => {
    if (e.created_at < since || !earlier(e)) return;
    if (e.type === 'stage_version_saved') {
      const affected = e.payload?.affected;
      if (Array.isArray(affected) && !affected.includes(targetId)) return;
      changes.push({
        stageId: e.stage_id,
        before: typeof e.payload?.prior_version_id === 'string' ? e.payload.prior_version_id : null,
        after: typeof e.payload?.version_id === 'string' ? e.payload.version_id : null,
        n: typeof e.payload?.version_number === 'number' ? (e.payload.version_number as number) : null,
      });
    } else if (e.type === 'stage_marked_complete' && !e.to_stage_id && evidenceOf(e)) {
      const prior = events.slice(0, i).reverse().find((p) => p.stage_id === e.stage_id && p.type === 'stage_marked_complete' && evidenceOf(p));
      const before = prior ? evidenceOf(prior) : null;
      if (before && before !== evidenceOf(e)) changes.push({ stageId: e.stage_id, before, after: evidenceOf(e), n: null });
    }
  });
  if (!changes.length) return null;
  if (new Set(changes.map((c) => c.stageId)).size > 1) return null;
  const first = changes[0];
  const last = changes[changes.length - 1];
  if (!first.before || !last.after || first.before === last.after) return null;
  return {
    stageId: first.stageId,
    label: template.stages[order.indexOf(first.stageId)]?.label ?? first.stageId,
    beforeId: first.before,
    afterId: last.after,
    beforeNumber: null,
    afterNumber: last.n,
  };
}
