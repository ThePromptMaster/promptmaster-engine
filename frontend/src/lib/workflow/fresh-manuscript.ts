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

import { getArtifact, listArtifacts } from '@/lib/supabase/versions';
import type { Artifact } from '@/types/project';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

import { manuscriptSourceFor } from './context';
import type { StageArtifactBundle } from './digest';

export class ManuscriptMissing extends Error {
  constructor(readonly holderLabel: string) {
    super(`There is no drafted text in ${holderLabel} yet, so this stage has nothing to read. Draft the chapters there first.`);
    this.name = 'ManuscriptMissing';
  }
}

const written = (a: Artifact | null | undefined) => (a?.long_form?.outline ?? []).some((s) => (s.content ?? '').trim().length > 0);

/**
 * `bundles` with the manuscript holder's artifact re-read, when `target`
 * reads the manuscript. Throws `ManuscriptMissing` when no chapter has text,
 * so a review is never written about a draft it was not given.
 *
 * With `projectId`, the holder is found in the database even when the page
 * has none, and the artifact on that stage that actually holds chapters wins
 * (25 Oct, Sean: Drafting done, and Continuity, Critique and Fact-check again
 * said there was no draft text — the page had no artifact for Drafting, or
 * held the outline's row instead of the one with the chapters).
 */
export async function withFreshManuscript(
  template: WorkflowTemplate,
  target: StageDefinition,
  bundles: Record<string, StageArtifactBundle>,
  projectId?: string
): Promise<Record<string, StageArtifactBundle>> {
  const source = manuscriptSourceFor(template, target);
  if (!source) return bundles;
  const holder = bundles[source.id]?.artifact ?? null;
  let fresh: Artifact | null = null;
  try {
    fresh = holder ? await getArtifact(holder.id) : null;
    if (!written(fresh) && projectId) {
      const onStage = (await listArtifacts(projectId)).filter((a) => a.stage_id === source.id);
      fresh = [...onStage].reverse().find(written) ?? fresh;
    }
  } catch {
    // A failed read falls back to the page's copy; the check below still holds.
  }
  const artifact = written(fresh) ? fresh : holder;
  if (!written(artifact)) throw new ManuscriptMissing(source.label);
  return artifact && artifact !== holder
    ? { ...bundles, [source.id]: { ...bundles[source.id], versions: bundles[source.id]?.versions ?? [], artifact } }
    : bundles;
}

/**
 * The same read where a missing manuscript is not this caller's to report
 * (an evaluation, a table revision): the page's copy when there is nothing
 * fresher, never an error.
 */
export async function freshOrPage(
  template: WorkflowTemplate,
  target: StageDefinition,
  bundles: Record<string, StageArtifactBundle>,
  projectId: string
): Promise<Record<string, StageArtifactBundle>> {
  if (!manuscriptSourceFor(template, target)) return bundles;
  return withFreshManuscript(template, target, bundles, projectId).catch(() => bundles);
}
