/**
 * Drafting and revising sections through the job queue (B2a).
 *
 * Extracted from the long-form renderer so the buttons and Go mode call the
 * same functions: "Start drafting" and Go's draft_sections enqueue the same
 * jobs with the same idempotency keys; "Apply N findings to every section"
 * and Go's revise_sections save the same snapshot first and queue the same
 * rewrites. There is no second path to the queue.
 *
 * Everything here that does not touch the database is pure and tested.
 */

import { enqueueSectionJob, isStoppedJob, revisionToEnqueue, type ProjectJob } from '@/lib/supabase/jobs';
import type { NewVersion } from '@/lib/supabase/versions';
import { formatManuscript } from '@/lib/workflow/digest';
import { formatRevisionNotes, type RevisionBrief } from '@/lib/workflow/revision';
import type { OutlineSection } from '@/types';
import type { Project } from '@/types/project';

/** Statuses that mean the server still has work to do. */
export const PENDING_JOB_STATUSES = new Set(['queued', 'leased']);

export function pendingJobs(jobs: readonly ProjectJob[]): ProjectJob[] {
  return jobs.filter((j) => PENDING_JOB_STATUSES.has(j.status));
}

/** Each section's latest job. Jobs arrive oldest first, so the last write wins. */
export function jobBySection(jobs: readonly ProjectJob[]): Map<string, ProjectJob> {
  return new Map(
    jobs
      .filter((j) => typeof j.payload?.section_id === 'string')
      .map((j) => [j.payload!.section_id as string, j] as const)
  );
}

export interface SectionTarget {
  section: OutlineSection;
  index: number;
}

/** Sections not yet written, in outline order. */
export function unwrittenSections(outline: readonly OutlineSection[]): SectionTarget[] {
  return outline.flatMap((section, index) => (section.status === 'complete' ? [] : [{ section, index }]));
}

/** Sections written, in outline order — what a revision pass rewrites. */
export function writtenSections(outline: readonly OutlineSection[]): SectionTarget[] {
  return outline.flatMap((section, index) => (section.status === 'complete' ? [{ section, index }] : []));
}

/** Sections whose last job stopped for good (failed, dead, cancelled). */
export function stoppedSections(outline: readonly OutlineSection[], jobs: readonly ProjectJob[]): SectionTarget[] {
  const latest = jobBySection(jobs);
  return outline.flatMap((section, index) =>
    isStoppedJob(latest.get(section.id) ?? null) ? [{ section, index }] : []
  );
}

/**
 * How many sections a stage's revision pass has rewritten.
 *
 * A section counts once any job this stage queued for it succeeded — not
 * only its latest job, which after Editing runs is Editing's, and would make
 * Revision read as never applied.
 */
export function revisedCount(outline: readonly OutlineSection[], jobs: readonly ProjectJob[], stageId: string): number {
  return outline.filter((s) =>
    jobs.some(
      (j) => j.status === 'succeeded' && j.payload?.stage_id === stageId && j.payload?.section_id === s.id
    )
  ).length;
}

export interface DraftJobsArgs {
  project: Project;
  artifactId: string;
  stageId: string;
  outline: readonly OutlineSection[];
  approvedOutlineVersionId: string | null;
  jobs: readonly ProjectJob[];
  /** Only these sections; every unwritten one when omitted. */
  sectionIds?: readonly string[];
  /** The stage's `entry_prompt_hint`: how this workflow wants a section written. */
  stageHint?: string;
}

/**
 * Enqueue every unwritten section (or the ones named). Sections that are done
 * collide on their idempotency key and quietly do nothing, which is the "not
 * regenerated unless requested" guarantee doing its job. Returns the ids of
 * the sections a job was queued for.
 */
export async function enqueueDraftJobs(args: DraftJobsArgs): Promise<string[]> {
  const { project, artifactId, stageId, outline, approvedOutlineVersionId, jobs, sectionIds, stageHint } = args;
  const wanted = sectionIds ? new Set(sectionIds) : null;
  const latest = jobBySection(jobs);
  const queued: string[] = [];
  for (const { section, index } of unwrittenSections(outline)) {
    if (wanted && !wanted.has(section.id)) continue;
    await enqueueSectionJob({
      project,
      artifactId,
      stageHint,
      stageId,
      outlineVersionId: approvedOutlineVersionId,
      sectionId: section.id,
      sectionIndex: index,
      // A section whose last job gave up needs a fresh key, or resuming
      // collides with the dead row and does nothing (PM-04).
      revision: revisionToEnqueue(section, latest.get(section.id) ?? null),
    });
    queued.push(section.id);
  }
  return queued;
}

/** The manuscript as it stands, as a version to save before a rewrite. */
export function manuscriptSnapshot(
  outline: readonly OutlineSection[],
  stageLabel: string,
  mode: Project['mode']
): NewVersion {
  return {
    content: formatManuscript([...outline], Number.POSITIVE_INFINITY),
    source_operation: 'manuscript_snapshot',
    instruction: `Before ${stageLabel}`,
    model: '',
    mode,
    change_summary: `The manuscript as it stood before ${stageLabel}.`,
  };
}

export interface RevisionJobsArgs {
  project: Project;
  artifactId: string;
  stageId: string;
  outline: readonly OutlineSection[];
  approvedOutlineVersionId: string | null;
  brief: RevisionBrief;
  /** The sections to rewrite; every written one when omitted. */
  targets?: readonly SectionTarget[];
  /** Saves the pre-pass snapshot — through the project store when there is one. */
  saveSnapshot: (version: NewVersion) => Promise<unknown>;
  /** The stage's `entry_prompt_hint`: how this workflow wants a section written. */
  stageHint?: string;
}

/**
 * Revision and Editing: rewrite the written sections with the stage's brief
 * and the findings accepted before it. The manuscript as it stood is saved
 * as a version first, because a rewrite replaces each section's text in
 * place and "each accepted finding becomes a version you can compare
 * against" is what the stage promises.
 */
export async function enqueueRevisionJobs(args: RevisionJobsArgs): Promise<string[]> {
  const { project, artifactId, stageId, outline, approvedOutlineVersionId, brief, saveSnapshot, stageHint } = args;
  const targets = args.targets ?? writtenSections(outline);
  await saveSnapshot(manuscriptSnapshot(outline, brief.stageLabel, project.mode));
  const revise = {
    stage_label: brief.stageLabel,
    instruction: brief.instruction,
    notes: formatRevisionNotes(brief.findings),
  };
  const queued: string[] = [];
  for (const { section, index } of targets) {
    await enqueueSectionJob({
      project,
      artifactId,
      stageHint,
      stageId,
      outlineVersionId: approvedOutlineVersionId,
      sectionId: section.id,
      sectionIndex: index,
      // A new revision means a new idempotency key: an explicit request, not a no-op.
      revision: (section.revision ?? 0) + 1,
      revise: brief.records?.[section.id] ? { ...revise, record: brief.records[section.id] } : revise,
    });
    queued.push(section.id);
  }
  return queued;
}
