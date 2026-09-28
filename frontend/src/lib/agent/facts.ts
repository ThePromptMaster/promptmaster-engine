/**
 * What a stage actually holds, read fresh from the database (B1).
 *
 * The loop used to decide from props, which lag a background reload by a
 * render or more, and which never held the outline (its own artifact) or the
 * chapters (in `artifacts.long_form`) at all. Go therefore planned against a
 * stage it could not see. These facts are read once per loop iteration and
 * again by a performer before it claims a post-condition holds.
 */

import { loadOutline } from '@/lib/outline/actions';
import { countNamedSections, emptyDocument, parseOutlineDocument } from '@/lib/outline/model';
import { jobBySection, pendingJobs, revisedCount, stoppedSections, type SectionTarget } from '@/lib/jobs/sections';
import { listProjectJobs, type ProjectJob } from '@/lib/supabase/jobs';
import { approvedOutlineVersionId, outlineApprovals } from '@/lib/supabase/outline';
import { getArtifact } from '@/lib/supabase/versions';
import { manuscriptArtifactFor } from '@/lib/workflow/context';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { revisionBrief, type RevisionBrief } from '@/lib/workflow/revision';
import { effectiveRenderer, itemSchemaFor, parseItems, stageDrafts, type StageItem, type StageItemSchema, isTriaged } from '@/lib/workflow/stage-artifact';
import { isTriageTable, splitUntriaged } from '@/lib/workflow/triage';
import type { StageDefinition, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { OutlineSection } from '@/types';
import type { OutlineDocument } from '@/types/outline';
import type { Artifact, ArtifactVersion, Evaluation, Project } from '@/types/project';

export interface OutlineFacts {
  artifact: Artifact;
  /** The working copy if there is one, else the head version's document. */
  doc: OutlineDocument;
  head: ArtifactVersion | null;
  headApproved: boolean;
  /** Any version has been approved: drafting is bound to something. */
  approved: boolean;
  namedSections: number;
  unsavedDraft: boolean;
}

export interface ManuscriptFacts {
  /** The artifact that holds the chapters — Drafting's, for Revision and Editing too. */
  artifact: Artifact;
  holderStageId: string;
  outline: OutlineSection[];
  total: number;
  complete: number;
  jobs: ProjectJob[];
  pendingJobs: ProjectJob[];
  stopped: SectionTarget[];
  approvedOutlineVersionId: string | null;
  /** Revision and Editing: the stage's brief and the findings accepted before it. */
  brief: RevisionBrief | null;
  revisedInStage: number;
}

export interface EvaluationFacts {
  count: number;
  /** The findings are about the head version, so applying them is meaningful. */
  aboutHead: boolean;
}

export interface ReviewFacts {
  items: StageItem[];
  schema: StageItemSchema;
  /** Undecided rows Go may decide (minor / moderate). */
  routine: StageItem[];
  /** Undecided rows only the user decides (major, or of unknown severity). */
  material: StageItem[];
  /**
   * An outcome table (claims, runs, alternatives, validation): every row is
   * the user's to decide, and revising the table cannot decide one. Found on
   * the production pass of 2026-09-29, where Go revised and re-checked a
   * claims table it could never satisfy.
   */
  outcome: boolean;
}

export interface StageFacts {
  outline?: OutlineFacts;
  manuscript?: ManuscriptFacts;
  evaluationFindings?: EvaluationFacts;
  review?: ReviewFacts;
}

export async function readStageFacts(input: {
  project: Project;
  template: WorkflowTemplate;
  stage: StageDefinition;
  bundles: Record<string, StageArtifactBundle>;
  events: readonly WorkflowEvent[];
  latestEvaluation?: Evaluation | null;
}): Promise<StageFacts> {
  const { project, template, stage, bundles, latestEvaluation } = input;
  const events = [...input.events];
  const facts: StageFacts = {};

  if (stage.renderer === 'outline') {
    const { artifact, versions, draft } = await loadOutline({ id: project.id, user_id: project.user_id }, stage.id);
    const head = versions.at(-1) ?? null;
    const doc = draft ?? (head ? parseOutlineDocument(head.content) : emptyDocument());
    const approvedIds = new Set(outlineApprovals(events).map((a) => a.outline_version_id));
    facts.outline = {
      artifact,
      doc,
      head,
      headApproved: head ? approvedIds.has(head.id) : false,
      approved: approvedOutlineVersionId(events) !== null,
      namedSections: countNamedSections(doc),
      unsavedDraft: draft !== null,
    };
  }

  if (stage.renderer === 'long_form') {
    const holder = manuscriptArtifactFor(template, stage, bundles);
    if (holder) {
      const [fresh, jobs] = await Promise.all([getArtifact(holder.id), listProjectJobs(project.id)]);
      const artifact = fresh ?? holder;
      const outline = artifact.long_form?.outline ?? [];
      const own = jobs.filter((j) => j.payload?.artifact_id === artifact.id);
      facts.manuscript = {
        artifact,
        holderStageId: artifact.stage_id ?? stage.id,
        outline,
        total: outline.length,
        complete: outline.filter((s) => s.status === 'complete').length,
        jobs: own,
        pendingJobs: pendingJobs(own),
        stopped: stoppedSections(outline, own),
        approvedOutlineVersionId: approvedOutlineVersionId(events),
        brief: revisionBrief(template, stage.id, bundles),
        revisedInStage: revisedCount(outline, own, stage.id),
      };
      void jobBySection; // re-exported helper used by callers; keeps the import honest
    }
  }

  if (effectiveRenderer(stage) === 'review') {
    const schema = itemSchemaFor(stage);
    const items = parseItems(bundles[stage.id]?.versions.at(-1)?.content) ?? [];
    if (isTriageTable(schema) && items.length) {
      facts.review = { items, schema, ...splitUntriaged(items, schema), outcome: false };
    } else if (items.length) {
      const undecided = items.filter((i) => !isTriaged(i, schema));
      facts.review = { items, schema, routine: [], material: undecided, outcome: true };
    }
  }

  if (stageDrafts(stage) && latestEvaluation) {
    const head = bundles[stage.id]?.versions.at(-1);
    facts.evaluationFindings = {
      count: latestEvaluation.findings?.length ?? 0,
      aboutHead: Boolean(head && latestEvaluation.version_id === head.id),
    };
  }

  return facts;
}
