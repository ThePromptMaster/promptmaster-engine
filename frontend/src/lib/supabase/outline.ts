import { RefusedRevision } from '@/lib/workflow/commit-check';
import { createClient } from './client';
import { appendVersion, createArtifact, listArtifacts } from './versions';
import { appendWorkflowEvent } from './workflow';
import { serializeOutlineDocument } from '@/lib/outline/model';
import type { OutlineDocument } from '@/types/outline';
import type { Artifact, ArtifactVersion } from '@/types/project';
import type { WorkflowEvent } from '@/lib/workflow/types';

/**
 * Outline persistence (FR-07).
 *
 * Two stores, deliberately:
 *
 *   - the committed outline is a row in artifact_versions, immutable, which is
 *     why outline history needs no code of its own;
 *   - the working draft is a column on the artifact, mutable, because
 *     "editing a draft mutates in place" is unrepresentable in an immutable
 *     table and because burying real outlines under half-typed ones in the
 *     restore list would make version history useless exactly where FR-10
 *     promises it is most useful.
 *
 * Approval is neither: it is an event, so that the record of who approved what
 * and when lives in the same log as every other workflow decision.
 */

export const OUTLINE_ARTIFACT_KIND = 'outline' as const;

/**
 * Find or create the outline artifact for a stage.
 *
 * Keyed on (project, stage, kind), matching the unique index. Two tabs opening
 * the stage at once therefore race into one row rather than forking the
 * stage's history in two.
 */
export async function ensureOutlineArtifact(
  projectId: string,
  userId: string,
  stageId: string
): Promise<Artifact> {
  const artifacts = await listArtifacts(projectId);
  const existing = artifacts.find(
    (a) => a.kind === OUTLINE_ARTIFACT_KIND && a.stage_id === stageId
  );
  if (existing) return existing;
  return createArtifact(projectId, userId, OUTLINE_ARTIFACT_KIND, 'Outline', stageId);
}

/**
 * Write the working draft.
 *
 * Unguarded, last write wins: the draft is one tab's scratch copy, and nothing
 * committed can be lost by overwriting it — committed outlines are versions.
 */
export async function saveOutlineDraft(
  artifact: Artifact,
  draft: OutlineDocument | null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('artifacts')
    .update({ outline_draft: draft })
    .eq('id', artifact.id);
  if (error) throw error;
}

export interface CommitOutlineOptions {
  sourceOperation?: string;
  instruction?: string;
  changeSummary?: string | null;
  model?: string;
  mode?: ArtifactVersion['mode'];
}

/**
 * Commit a draft as a version, then clear the draft.
 *
 * In that order. If the clear fails the draft still matches the version that
 * was just written, which the UI reconciles as "no unsaved changes"; the
 * reverse — a cleared draft and no version — loses the user's work.
 */
export async function commitOutlineVersion(
  artifact: Artifact,
  doc: OutlineDocument,
  options: CommitOutlineOptions = {}
): Promise<ArtifactVersion> {
  // The outline's commit check (G1): a generated outline with no sections is
  // refused before it can become the version drafting binds to. The user may
  // still empty their own.
  const operation = options.sourceOperation ?? 'outline_edit';
  if (operation !== 'outline_edit' && doc.items.length === 0) {
    throw new RefusedRevision('The outline came back with no sections, so the current version was kept');
  }
  const created = await appendVersion(artifact, {
    content: serializeOutlineDocument({ ...doc, forked_from_version_id: doc.forked_from_version_id ?? null }),
    source_operation: options.sourceOperation ?? 'outline_edit',
    instruction: options.instruction ?? '',
    model: options.model ?? '',
    mode: options.mode,
    change_summary: options.changeSummary ?? null,
  });

  await saveOutlineDraft(artifact, null);
  return created;
}

/**
 * Approve an outline version.
 *
 * Writes the event that the outline_approval stage's exit criterion reads, and
 * that drafting binds to. The version id travels in the payload: an approval
 * that does not say WHAT it approved cannot bind prose to an outline, which is
 * the whole mechanism.
 */
export async function approveOutlineVersion(
  projectId: string,
  userId: string,
  stageId: string,
  version: ArtifactVersion
): Promise<void> {
  await appendWorkflowEvent(
    projectId,
    userId,
    {
      type: 'outline_approved',
      stage_id: stageId,
      payload: {
        outline_version_id: version.id,
        outline_version_number: version.version_number,
        artifact_id: version.artifact_id,
      },
    }
  );
}

export interface OutlineApproval {
  outline_version_id: string;
  outline_version_number: number | null;
  created_at: string;
}

/** Read approvals out of the event log, newest last. */
export function outlineApprovals(events: WorkflowEvent[]): OutlineApproval[] {
  const approvals: OutlineApproval[] = [];
  for (const event of events) {
    if (event.type !== 'outline_approved') continue;
    const id = event.payload?.outline_version_id;
    if (typeof id !== 'string' || !id) continue;
    const n = event.payload?.outline_version_number;
    approvals.push({
      outline_version_id: id,
      outline_version_number: typeof n === 'number' ? n : null,
      created_at: event.created_at,
    });
  }
  return approvals;
}

/** The version drafting is bound to: the most recent approval. */
export function approvedOutlineVersionId(events: WorkflowEvent[]): string | null {
  return outlineApprovals(events).at(-1)?.outline_version_id ?? null;
}
