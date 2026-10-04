/**
 * The outline stage's actions, out of the component (B2a).
 *
 * Generating, committing, approving and materialising an outline used to live
 * inside `OutlineStagePanel` and the workspace, so the only thing that could
 * do them was a click. Go mode needs the same functions (Sean, 28 Sep: "Go
 * should call the same underlying functions the manual buttons call"), so
 * they live here and the panel calls them. No second path: the panel's
 * behaviour is unchanged, and the store's rows are the same rows.
 */

import { api } from '@/lib/api/client';
import { coerceOutlineDocument, mergeRegeneratedOutline } from '@/lib/outline/model';
import { longFormFromOutline } from '@/lib/outline/long-form';
import { approveOutlineVersion, ensureOutlineArtifact } from '@/lib/supabase/outline';
import { getArtifact, listVersions, saveLongForm } from '@/lib/supabase/versions';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import { draftingStageId } from '@/lib/workflow/derived-outline';
import type { StageDefinition, WorkflowTemplate } from '@/lib/workflow/types';
import type { OutlineDocument, OutlineItem, SectionDraftBinding } from '@/types/outline';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';

/** The stage that holds the outline: Book's own stage, or the drafting stage for a derived outline. */
export function outlineStageFor(template: WorkflowTemplate): StageDefinition | null {
  const explicit = template.stages.find((s) => s.renderer === 'outline');
  if (explicit) return explicit;
  if (template.outline_stage === 'derived') {
    const id = draftingStageId(template);
    return id ? (template.stages.find((s) => s.id === id) ?? null) : null;
  }
  return null;
}

export interface LoadedOutline {
  artifact: Artifact;
  versions: ArtifactVersion[];
  /** The unsaved working copy, if there is one. */
  draft: OutlineDocument | null;
}

/**
 * Whether a version holds an outline, rather than prose filed on the same row.
 *
 * A derived outline (Research) lives on the drafting stage's artifact, and so
 * does the paper: completing Drafting appends the manuscript there as a
 * "Full draft saved" version. Read as the outline's head, that prose parsed to
 * an empty outline and the approved plan vanished from the stage (4 Oct).
 */
export function isOutlineVersion(version: Pick<ArtifactVersion, 'content'>): boolean {
  const text = version.content.trimStart();
  return text.startsWith('{') || text.startsWith('[');
}

/** The outline artifact for a stage, its versions, and its working draft. Creates the artifact if needed. */
export async function loadOutline(project: Pick<Project, 'id' | 'user_id'>, stageId: string): Promise<LoadedOutline> {
  const artifact = await ensureOutlineArtifact(project.id, project.user_id, stageId);
  const versions = (await listVersions(artifact.id)).filter(isOutlineVersion);
  const draft = artifact.outline_draft ? coerceOutlineDocument(artifact.outline_draft) : null;
  return { artifact, versions, draft };
}

export interface GenerateOutlineArgs {
  project: Project;
  /** The outline as it stands; the result is merged over it so written prose stays attached. */
  doc: OutlineDocument;
  /** Prose already written per item: those items are kept, not replaced. */
  drafts?: readonly SectionDraftBinding[];
  /** Derived outlines (Research) re-derive; they never call a model. */
  derive?: () => OutlineItem[];
  /** How many sections to ask for; at least the current count, at least 3. */
  sectionCount?: number;
}

/**
 * A regenerated outline document — the model's (or the derivation's) sections
 * merged over the current document, so a section that has left the outline
 * lands in the orphan tray with its prose intact. Pure apart from the call;
 * the caller decides whether it becomes the draft or a version.
 */
export async function generateOutlineDraft(args: GenerateOutlineArgs): Promise<OutlineDocument> {
  const { project, doc, drafts = [], derive } = args;
  const keep = drafts.filter((d) => d.word_count > 0).map((d) => d.item_id);
  if (derive) return mergeRegeneratedOutline(doc, derive(), keep);
  const { outline } = await api.generateOutline({
    inputs: inputsFrom(project),
    suggested_section_count: Math.max(args.sectionCount ?? 0, doc.items.length, 3),
    model: project.model,
  });
  return mergeRegeneratedOutline(doc, outline.map((s) => ({ title: s.title, abstract: s.abstract })), keep);
}

/**
 * Write an approved outline into the drafting artifact's `long_form`, keeping
 * every section already written. The outline lives in `artifact_versions`;
 * drafting reads `artifacts.long_form`, and approving crosses that gap.
 */
export async function materialiseOutlineInto(doc: OutlineDocument, target: Artifact): Promise<void> {
  // Merge over the row as it is now, not the copy the caller loaded: the job
  // queue writes sections server-side, and a cached long_form from before them
  // would roll those chapters back out of the manuscript.
  const fresh = await getArtifact(target.id).catch(() => null);
  const existing = fresh ? fresh.long_form : (target.long_form ?? null);
  await saveLongForm(target.id, longFormFromOutline(doc, existing ?? null));
}

export interface ApproveOutlineArgs {
  project: Pick<Project, 'id' | 'user_id'>;
  stageId: string;
  /** A saved version: approving unsaved edits would bind drafting to something that exists only in one tab. */
  version: ArtifactVersion;
  /** Materialise into the drafting artifact; the caller owns that artifact. */
  materialise: (doc: OutlineDocument) => Promise<void>;
}

/**
 * Approve a saved outline version: the `outline_approved` event first, then
 * the materialisation — so a failure to materialise leaves an approval that
 * can be retried rather than a drafting state bound to nothing.
 */
export async function approveOutline(args: ApproveOutlineArgs): Promise<void> {
  const { project, stageId, version, materialise } = args;
  await approveOutlineVersion(project.id, project.user_id, stageId, version);
  await materialise(coerceOutlineDocument(JSON.parse(version.content)));
}
