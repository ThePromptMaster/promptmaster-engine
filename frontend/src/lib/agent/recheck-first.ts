/**
 * What changed in the stages before a reopened one (17 Nov). Pure.
 *
 * A change to an earlier stage reopens every finished stage after it, whatever
 * each one reads (`laterDoneStages`), and a reopened stage was always rewritten
 * whole. Sean (17 Nov): "a small change [should] get a quick check of the two
 * drafts it affects, while a bigger change gets a deeper review". So before
 * rewriting, the recheck looks at what changed in the earlier stages since this
 * one was reopened, and asks one small question (`assess-change`): did this
 * stage rely on it? If not, the stage is kept as it is and closed again.
 *
 * The change is read from the versions, not from the events that reopened the
 * stage: a stage is reopened by a save, by a completion on another version, or
 * by the user going back to edit an earlier stage ("Edit this stage"), and in
 * each case what matters is the earlier stage's text then and now.
 */

import type { StageArtifactBundle } from '@/lib/workflow/digest';
import type { WorkflowTemplate } from '@/lib/workflow/types';

export interface UpstreamChange {
  stageId: string;
  label: string;
  before: { id: string; number: number; content: string };
  after: { id: string; number: number; content: string };
}

/**
 * Each earlier stage whose current text differs from what it held when the
 * target's current version was written (`baselineAt`), with both texts: what
 * this stage was built on, and what is there now. Not the moment it was
 * reopened: the save that reopens it lands a moment before the event that says
 * so, and was missed (17 Nov, production pass). Null when a
 * changed earlier stage cannot be read this way — a manuscript, whose text is
 * its chapters, or one with no version from before — so the target is rewritten
 * as before. An empty list when nothing earlier changed: the target was reopened
 * by something else (a brief or fact change), which is not judged here.
 */
export function upstreamChanges(
  template: Pick<WorkflowTemplate, 'stages'>,
  bundles: Record<string, StageArtifactBundle | undefined>,
  targetId: string,
  baselineAt: string
): UpstreamChange[] | null {
  const at = template.stages.findIndex((s) => s.id === targetId);
  if (at < 0) return null;
  const out: UpstreamChange[] = [];
  for (const stage of template.stages.slice(0, at)) {
    const versions = bundles[stage.id]?.versions ?? [];
    const head = versions.at(-1);
    if (!head) continue;
    const before = [...versions].reverse().find((v) => v.created_at <= baselineAt);
    if (!before) {
      // Written only after the target was: a change we cannot compare.
      if (head.created_at > baselineAt) return null;
      continue;
    }
    if (before.id === head.id || before.content === head.content) continue;
    if (stage.renderer === 'long_form') return null;
    out.push({
      stageId: stage.id,
      label: stage.label,
      before: { id: before.id, number: before.version_number, content: before.content },
      after: { id: head.id, number: head.version_number, content: head.content },
    });
  }
  return out;
}
