/**
 * Why "Read the full work" may not show the latest change (14 Oct call, Sean:
 * "does that change just pretty automatically whenever you do a change it
 * thing?").
 *
 * The reader shows the deliverable stage (`deliverableStage`) and nothing
 * else. A "Change it" on any other stage — the brief, an earlier draft, the
 * optional Realign — is saved there and is not in the reader until the
 * deliverable is updated. Nothing said so, and it looked like the reader had
 * missed the change. This names the stage that was changed after the
 * deliverable, so the reader can say what it is showing. Pure.
 */

import { deliverableStage } from './engine';
import type { WorkflowTemplate } from './types';

export interface ReaderLag {
  /** The stage the reader shows. */
  shows: string;
  /** The stage changed after it. */
  changed: string;
  /** The changed stage comes before the deliverable, so updating the work carries the change into it. */
  feedsIt: boolean;
}

export function readerLag(
  template: WorkflowTemplate,
  stages: Record<string, { versions: readonly { created_at: string }[] } | undefined>
): ReaderLag | null {
  const deliverable = deliverableStage(template);
  // A manuscript is read from its sections, which every chapter edit updates.
  if (!deliverable || deliverable.renderer === 'long_form') return null;
  const shownAt = stages[deliverable.id]?.versions.at(-1)?.created_at;
  if (!shownAt) return null;
  const order = template.stages.map((s) => s.id);
  let latest: { id: string; at: string } | null = null;
  for (const s of template.stages) {
    if (s.id === deliverable.id) continue;
    const at = stages[s.id]?.versions.at(-1)?.created_at;
    if (at && at > shownAt && (!latest || at > latest.at)) latest = { id: s.id, at };
  }
  if (!latest) return null;
  const changed = template.stages.find((s) => s.id === latest!.id)!;
  return {
    shows: deliverable.label,
    changed: changed.label,
    feedsIt: order.indexOf(changed.id) < order.indexOf(deliverable.id),
  };
}

/** The reader's one line about it. */
export function readerLagNote(lag: ReaderLag): string {
  return lag.feedsIt
    ? `This shows ${lag.shows}. Your latest change, to ${lag.changed}, reaches it when ${lag.shows} is updated — press Apply and continue at the top of the page.`
    : `This shows ${lag.shows}. Your latest change was to ${lag.changed}, which is kept as its own stage — open it there to read it.`;
}
