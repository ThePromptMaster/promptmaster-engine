/**
 * What a stage actually holds, read fresh from the database (B1).
 *
 * The loop used to decide from props, which lag a background reload by a
 * render or more, and which never held the outline (its own artifact) or the
 * chapters (in `artifacts.long_form`) at all. Go therefore planned against a
 * stage it could not see. These facts are read once per loop iteration and
 * again before a step is performed. Everything the planner is then told
 * (digest.ts) and every requirement it is judged against (`contextWithFacts`)
 * comes from this read, not from props. After a step that claims a change,
 * `readOutcomeProof` reads the project once more and outcome.ts checks the
 * claim against it.
 */

import { loadOutline, outlineStageFor } from '@/lib/outline/actions';
import { countNamedSections, emptyDocument, parseOutlineDocument } from '@/lib/outline/model';
import { jobBySection, pendingJobs, revisedCount, stoppedSections, type SectionTarget } from '@/lib/jobs/sections';
import { listProjectJobs, type ProjectJob } from '@/lib/supabase/jobs';
import { approvedOutlineVersionId, outlineApprovals } from '@/lib/supabase/outline';
import { checkVersions, getArtifact, getEvaluation } from '@/lib/supabase/versions';
import { manuscriptArtifactFor, manuscriptSourceFor } from '@/lib/workflow/context';
import type { StageArtifactBundle } from '@/lib/workflow/digest';
import { revisionBrief, type RevisionBrief } from '@/lib/workflow/revision';
import { effectiveRenderer, itemSchemaFor, parseItems, stageDrafts, type StageItem, type StageItemSchema, isTriaged } from '@/lib/workflow/stage-artifact';
import { isTriageTable, splitUntriaged } from '@/lib/workflow/triage';
import { projectState } from '@/lib/workflow/engine';
import type { StageContext, StageDefinition, WorkflowEvent, WorkflowTemplate } from '@/lib/workflow/types';
import type { OutlineSection } from '@/types';
import type { OutlineDocument } from '@/types/outline';
import type { Artifact, ArtifactVersion, Evaluation, Project } from '@/types/project';
import { actionFor } from './actions';
import type { OutcomeProof } from './outcome';
import type { StepOutcome } from './perform';

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

/**
 * The chapters a stage after drafting reads but does not own — Continuity,
 * Critique, Fact-check, Final review. Read-only: nothing in the policy turns
 * on it, so a review stage is never offered the drafting moves. Kept apart
 * from `manuscript`, which is the long-form stage's own and drives them.
 */
export interface ManuscriptBrief {
  holderStageId: string;
  holderLabel: string;
  outline: OutlineSection[];
  total: number;
  /** Sections that hold text. */
  complete: number;
  words: number;
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
  /** Any outline version is approved, from the event log as just read. */
  outlineApproved?: boolean;
  outline?: OutlineFacts;
  manuscript?: ManuscriptFacts;
  /** The manuscript this stage reviews, when it is a stage after drafting. */
  reads_manuscript?: ManuscriptBrief;
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
  const facts: StageFacts = { outlineApproved: approvedOutlineVersionId(events) !== null };

  // The stage that holds the outline: Book's Outline stage, or the drafting
  // stage of a workflow whose outline is derived (Research). Reading it only
  // for the `outline` renderer left Go on a Research drafting stage with no
  // outline in sight and no move that could make one (1 Oct, item 4).
  if (outlineStageFor(template)?.id === stage.id) {
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

  // A stage after drafting reads the chapters. Read fresh for the same reason
  // as above: Revision and Editing rewrite them in place, and the store's
  // bundle can lag that by a render or more. Without this the planner saw an
  // empty review stage and "no data", and marked it stuck for a draft that
  // existed (2 Oct screenshots).
  const source = manuscriptSourceFor(template, stage);
  if (source) {
    const holder = bundles[source.id]?.artifact ?? null;
    const fresh = holder ? await getArtifact(holder.id).catch(() => null) : null;
    const outline = (fresh ?? holder)?.long_form?.outline ?? [];
    if (outline.length) {
      const written = outline.filter((s) => (s.content ?? '').trim().length > 0);
      facts.reads_manuscript = {
        holderStageId: source.id,
        holderLabel: source.label,
        outline,
        total: outline.length,
        complete: written.length,
        words: written.reduce((n, s) => n + (s.content ?? '').trim().split(/\s+/).filter(Boolean).length, 0),
      };
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

/**
 * The exit-criteria context with this stage's entries replaced by what was
 * just read. Pure.
 *
 * The workspace builds its context from the store, which lags the section
 * jobs (they write server-side) and the outline panel's working copy. Go
 * judged "every section is written" and "the outline is approved" from that,
 * while choosing its moves from the fresh read — two answers to one question
 * (1 Oct, item 1: "Go said the drafting artifact was empty while all three
 * chapters had already been written and were visible").
 */
export function contextWithFacts(context: StageContext, stage: StageDefinition, facts: StageFacts): StageContext {
  let next = context;
  if (facts.outlineApproved !== undefined) next = { ...next, outlineApproved: facts.outlineApproved };
  if (facts.manuscript) {
    const m = facts.manuscript;
    next = {
      ...next,
      sections: { ...next.sections, [stage.id]: { total: m.total, complete: m.complete } },
      artifactNonEmpty: {
        ...next.artifactNonEmpty,
        [stage.id]: next.artifactNonEmpty[stage.id] || m.outline.some((s) => (s.content ?? '').trim().length > 0),
      },
    };
  }
  if (facts.outline) {
    next = { ...next, itemCounts: { ...next.itemCounts, [stage.id]: facts.outline.namedSections } };
  }
  return next;
}

/**
 * Read back what a step says it changed. The check itself is pure
 * (outcome.ts `verifyOutcome`); this only fetches.
 */
export async function readOutcomeProof(input: {
  actionKey: string;
  outcome: StepOutcome;
  template: WorkflowTemplate;
  stage: StageDefinition;
  facts: StageFacts;
  loadEvents: () => Promise<readonly WorkflowEvent[]>;
}): Promise<OutcomeProof> {
  const { actionKey, outcome, template, stage, facts } = input;
  const performer = actionFor(actionKey)?.performer;
  const proof: OutcomeProof = {};
  const versionIds = outcome.changes.version_ids ?? [];

  if (performer === 'evaluate') {
    proof.evaluated = versionIds.length > 0 && (await getEvaluation(versionIds[0])) !== null;
    return proof;
  }
  if (versionIds.length) proof.versions = await checkVersions(versionIds);
  if (performer === 'sections' && facts.manuscript) {
    const fresh = await getArtifact(facts.manuscript.artifact.id);
    proof.sectionsWithContent = (fresh?.long_form?.outline ?? []).filter((s) => (s.content ?? '').trim()).map((s) => s.id);
  }
  if (performer === 'advance') {
    const state = projectState(template, [...(await input.loadEvents())]);
    proof.stage = {
      currentStageId: state.current_stage_id,
      status: state.stages[stage.id]?.status,
      expectedStageId: stage.transitions.default_next ?? null,
    };
  }
  return proof;
}
