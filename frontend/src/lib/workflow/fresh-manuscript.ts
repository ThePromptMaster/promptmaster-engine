/**
 * The chapters a stage after drafting reads, read fresh from the database
 * before it is generated (Sean, 10 Oct, email 6.2: Drafting was complete, and
 * Continuity, Critique and Fact-check each said there was no draft text).
 *
 * The chapters are written into Drafting's artifact by the job queue, and the
 * page's copy only catches up on a reload. Go's planner already read them
 * fresh (`lib/agent/facts.ts`), so it said the stage was ready; the generator
 * read the page's copy, found no text, and the model said so. Both now read
 * the same thing.
 */

import { getArtifact } from '@/lib/supabase/versions';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

import { manuscriptSourceFor } from './context';
import type { StageArtifactBundle } from './digest';

export class ManuscriptMissing extends Error {
  constructor(readonly holderLabel: string) {
    super(`There is no drafted text in ${holderLabel} yet, so this stage has nothing to read. Draft the chapters there first.`);
    this.name = 'ManuscriptMissing';
  }
}

/**
 * `bundles` with the manuscript holder's artifact re-read, when `target`
 * reads the manuscript. Throws `ManuscriptMissing` when no chapter has text,
 * so a review is never written about a draft it was not given.
 */
export async function withFreshManuscript(
  template: WorkflowTemplate,
  target: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): Promise<Record<string, StageArtifactBundle>> {
  const source = manuscriptSourceFor(template, target);
  if (!source) return bundles;
  const holder = bundles[source.id]?.artifact ?? null;
  let fresh = null;
  try {
    fresh = holder ? await getArtifact(holder.id) : null;
  } catch {
    // A failed read falls back to the page's copy; the check below still holds.
  }
  const artifact = fresh ?? holder;
  const written = (artifact?.long_form?.outline ?? []).some((s) => (s.content ?? '').trim().length > 0);
  if (!written) throw new ManuscriptMissing(source.label);
  return fresh ? { ...bundles, [source.id]: { ...bundles[source.id], artifact: fresh } } : bundles;
}
