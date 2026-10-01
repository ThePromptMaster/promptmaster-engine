/**
 * What a stage can show for being complete (PM-13), for every renderer.
 *
 * `stage_marked_complete` carries an `evidence_version_id`, and the database
 * checks it belongs to an artifact of that stage (20260927000000). For prose,
 * list and review stages that is the head version. Long-form stages had none:
 * the chapters live in `artifacts.long_form`, written section by section by
 * the job queue, and no version row ever existed — so Drafting could only
 * ever be "complete" without evidence, Go mode's advance always left it open,
 * and the export had nothing to print (Sean, 28 Sep, items 1, 2 and 15).
 *
 * Rule: `artifacts.long_form` is the live text; `artifact_versions` rows on
 * a long-form stage are its saved snapshots. Completing the stage saves one —
 * the assembled manuscript, `source_operation: 'long_form_complete'` — unless
 * the head already holds exactly that text. Revision and Editing work on
 * Drafting's manuscript and get their own snapshot on their own artifact, so
 * "the manuscript as Revision left it" is a version too.
 *
 * Used by every path that completes a stage: the transition bar, "Mark this
 * stage complete", the tick that closes a left-open stage, and Go mode's
 * advance. One function, so they cannot disagree about what counts.
 */

import type { NewVersion } from '@/lib/supabase/versions';
import type { Project } from '@/types/project';
import { manuscriptArtifactFor } from './context';
import { formatManuscript, type StageArtifactBundle } from './digest';
import type { StageDefinition, WorkflowTemplate } from './types';

export const LONG_FORM_COMPLETE = 'long_form_complete';

export interface EvidenceInput {
  template: WorkflowTemplate;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  project: Pick<Project, 'mode'>;
  /** Appends a version to the stage's artifact, creating the artifact if needed. */
  appendStageVersion?: (stageId: string, name: string, version: NewVersion) => Promise<unknown>;
}

/** The written manuscript a long-form stage works on, or null if it is not all written. */
export function completedManuscript(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): { text: string; sections: number; words: number } | null {
  if (stage.renderer !== 'long_form') return null;
  const outline = manuscriptArtifactFor(template, stage, bundles)?.long_form?.outline ?? [];
  if (outline.length === 0 || outline.some((s) => s.status !== 'complete')) return null;
  const text = formatManuscript(outline, Number.POSITIVE_INFINITY);
  if (!text.trim()) return null;
  return { text, sections: outline.length, words: text.split(/\s+/).filter(Boolean).length };
}

/**
 * The content a stage's summary is written from: the head version, or for a
 * long-form stage the manuscript itself (its versions are snapshots, and may
 * not exist yet).
 */
export function stageContentForSummary(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): string {
  if (stage.renderer === 'long_form') {
    const outline = manuscriptArtifactFor(template, stage, bundles)?.long_form?.outline ?? [];
    return formatManuscript(outline, Number.POSITIVE_INFINITY);
  }
  return bundles[stage.id]?.versions.at(-1)?.content ?? '';
}

/**
 * The version id to cite as evidence, or undefined when there is nothing to
 * cite — in which case the caller records a plain completion, as before.
 */
export async function stageEvidence(input: EvidenceInput): Promise<string | undefined> {
  const { template, stage, bundles, project, appendStageVersion } = input;
  const own = bundles[stage.id];
  const head = own?.artifact?.stage_id === stage.id ? own.versions.at(-1) : undefined;

  if (stage.renderer !== 'long_form') return head?.id;

  const manuscript = completedManuscript(template, stage, bundles);
  if (!manuscript) return undefined;
  // Idempotent: completing the same finished manuscript twice cites one snapshot.
  if (head && head.content === manuscript.text) return head.id;
  if (!appendStageVersion) return undefined;

  const created = await appendStageVersion(stage.id, stage.label, {
    content: manuscript.text,
    source_operation: LONG_FORM_COMPLETE,
    instruction: `${stage.label}: every section written`,
    model: '',
    mode: project.mode,
    change_summary: `Full draft saved — ${manuscript.sections} sections, ${manuscript.words.toLocaleString()} words.`,
  });
  const id = (created as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}
