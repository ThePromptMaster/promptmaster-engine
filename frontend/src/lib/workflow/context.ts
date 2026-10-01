/**
 * The exit-criteria context, built once for every stage. Pure.
 *
 * Until 2026-09-28 the workspace built this for the stage the user was
 * *viewing*: `sectionsTotal` came from the viewed stage's artifact and the
 * findings counts were filled in only for that one stage. Go mode then
 * evaluated the *current* stage with the same object, so browsing Positioning
 * while Go sat on Drafting made "every section written" read as "no sections
 * yet", and Go left a finished Drafting stage open. Sean's 28 Sep feedback,
 * item 1: "workflow state, actual artifacts, Go state and recommendation state
 * are not always reading from the same authoritative project state."
 *
 * Every per-stage fact is now keyed by stage id, so `evaluateStage(template,
 * anyStageId, context)` is right for any stage, whoever asks.
 */

import { countNamedSections, parseOutlineDocument } from '@/lib/outline/model';
import { approvedOutlineVersionId } from '@/lib/supabase/outline';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import { draftingStageId } from './derived-outline';
import type { StageArtifactBundle } from './digest';
import { effectiveRenderer, isTriaged, itemSchemaFor, parseItems, rendererHoldsItems } from './stage-artifact';
import type { StageContext, StageDefinition, WorkflowEvent, WorkflowTemplate } from './types';

export interface BuildContextInput {
  template: WorkflowTemplate;
  project: Pick<Project, 'objective' | 'audience' | 'constraints' | 'manual_checks'>;
  /** Per stage id: that stage's artifact and its versions. */
  bundles: Record<string, StageArtifactBundle>;
  /**
   * The project-level artifact's versions, for a single-output project whose
   * one artifact has no stage row. Ignored for any stage that has a bundle.
   */
  projectVersions?: readonly ArtifactVersion[];
  events: WorkflowEvent[];
  /**
   * Live section counts reported by a mounted outline panel, per stage id.
   * They override the saved outline's count while the panel is showing an
   * unsaved draft.
   */
  outlineCounts?: Record<string, number>;
}

/**
 * The artifact a long-form stage works on.
 *
 * Revision and Editing are long-form stages with no manuscript of their own:
 * they work on the one Drafting wrote. Reading their own (empty) artifact made
 * `all_sections_complete` say "no sections yet" to someone who had just
 * finished drafting a whole book.
 */
export function manuscriptArtifactFor(
  template: WorkflowTemplate,
  stage: StageDefinition,
  bundles: Record<string, StageArtifactBundle>
): Artifact | null {
  const own = bundles[stage.id]?.artifact ?? null;
  if (stage.renderer !== 'long_form' || own?.long_form) return own;
  const drafting = draftingStageId(template);
  if (!drafting || drafting === stage.id) return own;
  return bundles[drafting]?.artifact ?? own;
}

export function buildStageContext(input: BuildContextInput): StageContext {
  const { template, project, bundles, projectVersions = [], events, outlineCounts = {} } = input;

  const itemCounts: Record<string, number> = {};
  const itemsMissingStatus: Record<string, number> = {};
  const artifactNonEmpty: Record<string, boolean> = {};
  const sections: StageContext['sections'] = {};
  const findings: StageContext['findings'] = {};

  for (const s of template.stages) {
    const bundle = bundles[s.id];
    const content = bundle
      ? (bundle.versions.at(-1)?.content ?? '')
      : // The single-output project keeps its one artifact, which has no stage row.
        (projectVersions.at(-1)?.content ?? '');
    artifactNonEmpty[s.id] = content.trim().length > 0;

    if (s.renderer === 'long_form') {
      const outline = manuscriptArtifactFor(template, s, bundles)?.long_form?.outline ?? [];
      sections[s.id] = {
        total: outline.length,
        complete: outline.filter((section) => section.status === 'complete').length,
      };
      // The chapters are this stage's work even though no version row holds
      // them: a written manuscript is not an empty stage (1 Oct, item 1).
      if (outline.some((section) => (section.content ?? '').trim())) artifactNonEmpty[s.id] = true;
      continue;
    }

    if (s.renderer === 'outline') {
      // The saved outline, for a stage the panel is not currently showing.
      // The live count overrides it while the panel is mounted.
      itemCounts[s.id] = outlineCounts[s.id] ?? countNamedSections(parseOutlineDocument(content));
      continue;
    }

    if (!rendererHoldsItems(s.renderer)) continue;
    const items = parseItems(content);
    if (!items) continue;

    const schema = itemSchemaFor(s);
    itemCounts[s.id] = items.length;
    itemsMissingStatus[s.id] = items.filter((i) => !isTriaged(i, schema)).length;

    // Findings criteria are about one stage, not the whole project: "3
    // untriaged" on Critique must not count Continuity's. Keyed by stage so
    // every review stage's count is available at once.
    if (effectiveRenderer(s) === 'review') {
      findings[s.id] = { total: items.length, triaged: items.length - itemsMissingStatus[s.id] };
    }
  }

  return {
    fields: {
      objective: project.objective,
      audience: project.audience,
      constraints: project.constraints,
    },
    itemCounts,
    itemsMissingStatus,
    artifactNonEmpty,
    // Approval is an event, not a mode the long-form machine happens to be in.
    outlineApproved: approvedOutlineVersionId(events) !== null,
    sections,
    findings,
    manualChecks: project.manual_checks ?? {},
  };
}
