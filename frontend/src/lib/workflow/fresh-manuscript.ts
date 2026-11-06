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

import { getArtifact, listArtifacts, listVersions } from '@/lib/supabase/versions';
import type { Artifact } from '@/types/project';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';

import { manuscriptArtifactFor, manuscriptSourceFor } from './context';
import { effectiveRenderer, itemSchemaFor } from './stage-artifact';
import { isTriageTable } from './triage';
import type { StageArtifactBundle } from './digest';

/** A stage asked to read work that has no saved text yet: nothing is written about nothing (4 Nov). */
export class InputMissing extends Error {
  constructor(readonly holderLabel: string, message?: string) {
    super(message ?? `There is nothing in ${holderLabel} yet, so this check has nothing to read. Write ${holderLabel} first.`);
    this.name = 'InputMissing';
  }
}

export class ManuscriptMissing extends InputMissing {
  constructor(holderLabel: string) {
    super(holderLabel, `There is no drafted text in ${holderLabel} yet, so this stage has nothing to read. Draft the chapters there first.`);
    this.name = 'ManuscriptMissing';
  }
}

/**
 * The written stage a check reads, when the manuscript is not what it reads:
 * the nearest written stage before it (4 Nov, Sean: "A downstream stage should
 * receive the current artifact and report when a required input is missing").
 */
export function checkedStageFor(template: WorkflowTemplate, target: StageDefinition): StageDefinition | null {
  // Only a findings table checks earlier work. A table of runs or results
  // (Research's Experiment) is work of its own, written from the plan, and is
  // never held up by an empty stage before it (CI, 4 Nov: criteria.spec).
  if (effectiveRenderer(target) !== 'review' || !isTriageTable(itemSchemaFor(target)) || manuscriptSourceFor(template, target)) return null;
  const at = template.stages.findIndex((s) => s.id === target.id);
  return [...template.stages.slice(0, Math.max(0, at))].reverse().find((s) => s.renderer === 'prose' || s.renderer === 'long_form') ?? null;
}

/** Throws `InputMissing` when the stage a check reads has no saved text. */
export function assertCheckedInput(template: WorkflowTemplate, target: StageDefinition, bundles: Record<string, StageArtifactBundle>): void {
  const source = checkedStageFor(template, target);
  if (source && source.renderer === 'prose' && !(bundles[source.id]?.versions.at(-1)?.content ?? '').trim()) {
    throw new InputMissing(source.label);
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
  if (!source) {
    assertCheckedInput(template, target, bundles);
    return bundles;
  }
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

/**
 * `bundles` with a long-form stage's chapters and saved versions read again
 * (5 Nov, a six-chapter book test). The chapters are written by the job queue,
 * so the copy a Go step started with holds the text from before its own
 * repair: "Full draft saved" was the old manuscript four times in a row (v3=v4,
 * v5=v6, v7=v8, v9=v10), and the objective check judged the old chapters.
 * `withFreshManuscript` does not cover this: it reads for a stage after the
 * manuscript, and a long-form stage has none. A failed read keeps the page's
 * copy; a stage that is not long-form is returned as it is.
 */
export async function withCurrentLongForm(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): Promise<Record<string, StageArtifactBundle>> {
  if (stage.renderer !== 'long_form') return bundles;
  const holder = manuscriptArtifactFor(template, stage, bundles);
  if (!holder) return bundles;
  try {
    const [artifact, versions] = await Promise.all([getArtifact(holder.id), listVersions(holder.id)]);
    if (!artifact) return bundles;
    const holderStage = artifact.stage_id ?? stage.id;
    const next = { ...bundles, [holderStage]: { ...bundles[holderStage], artifact, versions } };
    // A later long-form stage (Revision, Editing) keeps its own snapshots on its own artifact.
    const own = bundles[stage.id]?.artifact;
    if (own && own.id !== holder.id) next[stage.id] = { ...bundles[stage.id], versions: await listVersions(own.id) };
    return next;
  } catch {
    return bundles;
  }
}
