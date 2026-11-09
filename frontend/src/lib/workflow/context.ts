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

import { cutSections } from '@/lib/jobs/continuation';
import { countNamedSections, parseOutlineDocument } from '@/lib/outline/model';
import { approvedOutlineVersionId } from '@/lib/supabase/outline';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { MeasuredLine } from '@/types';
import { draftingStageId } from './derived-outline';
import type { StageArtifactBundle } from './digest';
import { carriedForwardUnmet, deferredNotBlocking, confirmableProposals, openFindingRows, openUnmet, effectiveRenderer, isTriaged, itemSchemaFor, parseItems, rendererHoldsItems } from './stage-artifact';
import type { OpenFindingRow, StageContext, StageDefinition, WorkflowEvent, WorkflowTemplate } from './types';
import { deliverableStage, rowsRequired } from './engine';
import { currentFacts } from './facts';
import { describeUnsupported, unsupportedClaims } from './evidence-claims';
import { measure, parseRequirements, requirementLabel, requirementsForStage, type MeasurableRequirement, type Measurement } from './measurable';

export interface BuildContextInput {
  template: WorkflowTemplate;
  project: Pick<Project, 'objective' | 'audience' | 'constraints' | 'manual_checks'> & Partial<Pick<Project, 'output_format' | 'facts' | 'code_runs'>>;
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

/**
 * The stage whose chapters a later stage reads.
 *
 * The manuscript lives on the first long-form stage's artifact (Revision and
 * Editing rewrite it in place). A stage after it that is not itself long-form
 * — Continuity, Critique, Fact-check, Final review — exists to read those
 * chapters. One definition, used by the stage digest that generates the
 * review and by Go's planner state: until 2026-10-03 only the first knew, so
 * Go marked every review stage stuck for "no draft text" while the draft sat
 * two stages back (the client's 2 Oct screenshots).
 */
export function manuscriptSourceFor(template: WorkflowTemplate, stage: StageDefinition): StageDefinition | null {
  const draftingIndex = template.stages.findIndex((s) => s.renderer === 'long_form');
  if (draftingIndex < 0 || stage.renderer === 'long_form') return null;
  const index = template.stages.findIndex((s) => s.id === stage.id);
  return index > draftingIndex ? template.stages[draftingIndex] : null;
}

export function buildStageContext(input: BuildContextInput): StageContext {
  const { template, project, bundles, projectVersions = [], events, outlineCounts = {} } = input;

  const itemCounts: Record<string, number> = {};
  const itemsMissingStatus: Record<string, number> = {};
  const itemsProposed: Record<string, number> = {};
  const itemFieldGaps: Record<string, Record<string, number>> = {};
  const itemStatusCounts: Record<string, Record<string, number>> = {};
  const artifactNonEmpty: Record<string, boolean> = {};
  const sections: StageContext['sections'] = {};
  const findings: StageContext['findings'] = {};
  const carriedForward: Record<string, string[]> = {};
  const deferred: Record<string, { row: string; reason: string }[]> = {};
  const openUnmetRows: Record<string, number> = {};
  const openRows: Record<string, OpenFindingRow[]> = {};

  for (const s of template.stages) {
    const bundle = bundles[s.id];
    const content = bundle
      ? (bundle.versions.at(-1)?.content ?? '')
      : // The single-output project keeps its one artifact, which has no stage row.
        (projectVersions.at(-1)?.content ?? '');
    artifactNonEmpty[s.id] = content.trim().length > 0;

    if (s.renderer === 'long_form') {
      const outline = manuscriptArtifactFor(template, s, bundles)?.long_form?.outline ?? [];
      const cut = cutSections(outline, events).map((section) => section.title);
      sections[s.id] = {
        total: outline.length,
        complete: outline.filter((section) => section.status === 'complete').length,
        ...(cut.length ? { cut } : {}),
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
    itemsProposed[s.id] = confirmableProposals(items, schema).length;
    itemStatusCounts[s.id] = {};
    for (const i of items) {
      if (!i.status) continue;
      // A stronger status counts as the weaker ones it includes (5 Oct):
      // "AI verified" is also "Retrieved" for "at least three works retrieved".
      const implied = schema.statuses?.find((o) => o.value === i.status)?.implies ?? [];
      for (const s2 of new Set([i.status, ...implied])) itemStatusCounts[s.id][s2] = (itemStatusCounts[s.id][s2] ?? 0) + 1;
    }
    itemFieldGaps[s.id] = Object.fromEntries(
      schema.fields.map((f) => [f.key, items.filter((i) => !(i[f.key] ?? '').trim()).length])
    );

    // Findings criteria are about one stage, not the whole project: "3
    // untriaged" on Critique must not count Continuity's. Keyed by stage so
    // every review stage's count is available at once.
    if (effectiveRenderer(s) === 'review') {
      findings[s.id] = { total: items.length, triaged: items.length - itemsMissingStatus[s.id] };
      const optional = !rowsRequired(s);
      const carried = carriedForwardUnmet(items, schema, optional);
      if (carried.length) carriedForward[s.id] = carried;
      const later = deferredNotBlocking(items, schema, optional);
      if (later.length) deferred[s.id] = later;
      const unmet = openUnmet(items, schema);
      if (unmet) openUnmetRows[s.id] = unmet;
      const rows = openFindingRows(items, schema);
      if (rows.length) openRows[s.id] = rows;
    }
  }

  // C1 (8 Oct): word ranges, limits and question counts the user asked for,
  // measured on the stages that produce what they describe.
  const measured: Record<string, Measurement[]> = {};
  const unverified: Record<string, Measurement[]> = {};
  for (const s of template.stages) {
    const content = bundles[s.id]?.versions.at(-1)?.content ?? '';
    const results = measureStageContent(project, template, s, content);
    if (results.length) measured[s.id] = results;
    const notCounted = unverifiedLimits(project, template, s, content);
    if (notCounted.length) unverified[s.id] = notCounted;
  }

  return {
    measured,
    ...(Object.keys(unverified).length ? { unverified } : {}),
    carriedForward,
    deferred,
    openUnmet: openUnmetRows,
    openRows,
    fields: {
      objective: project.objective,
      audience: project.audience,
      constraints: project.constraints,
    },
    itemCounts,
    itemsMissingStatus,
    itemsProposed,
    itemFieldGaps,
    itemStatusCounts,
    artifactNonEmpty,
    // Approval is an event, not a mode the long-form machine happens to be in.
    outlineApproved: approvedOutlineVersionId(events) !== null,
    sections,
    findings,
    manualChecks: project.manual_checks ?? {},
  };
}

/**
 * The requirements that govern: an accepted requirement fact replaces the
 * brief's figure of the same kind (11 Oct, production: the lunch invitation's
 * fact said "under 70 words", the objective still said "under 120", and the
 * 120 was what was measured). It replaces one about the same thing, or one
 * about the whole deliverable when the objective names the fact's subject as
 * what it asks for ("a lunch invitation … under 120 words"); then it measures
 * the whole deliverable, as the figure it replaces did. Facts are in the order
 * they were accepted, so a later one governs.
 *
 * A fact that says a limit does not apply ("there is no 500-word limit on the
 * complete package") removes it rather than adding one (17 Oct, Sean,
 * FIELDGUIDE: that clarification was read back as a 500-word limit and kept
 * the package blocked).
 */
export function governingRequirements(
  objective: string,
  brief: readonly MeasurableRequirement[],
  facts: readonly (readonly MeasurableRequirement[])[]
): MeasurableRequirement[] {
  let out = brief.filter((r) => !r.retires);
  for (const fromFact of facts) {
    for (const f of fromFact) {
      if (f.retires) {
        out = out.filter((r) => !(r.kind === f.kind && r.subject === f.subject && (f.max === undefined || r.max === undefined || r.max === f.max)));
        continue;
      }
      const names = (subject: string) => Boolean(subject) && new RegExp(`\\b${subject}s?\\b`, 'i').test(objective);
      const same = out.findIndex((r) => r.kind === f.kind && r.subject === f.subject);
      const whole = out.findIndex((r) => r.kind === f.kind && r.subject === '' && names(f.subject));
      if (same >= 0) out[same] = f;
      else if (whole >= 0) out[whole] = { ...f, id: out[whole].id, subject: '' };
      else out = [...out, f];
    }
  }
  return out;
}

/**
 * The measurable requirements a stage answers for, measured on `content`
 * (C1). Used for the saved head, and by a repair before it saves (L-63).
 */
export function measureStageContent(
  project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'output_format' | 'facts' | 'code_runs'>>,
  template: WorkflowTemplate,
  stage: StageDefinition,
  content: string
): Measurement[] {
  if (!content.trim()) return [];
  const evidence = measureEvidence(project, template, stage, content);
  return [
    ...stageRequirements(project, template, stage)
      .map(({ requirement, whole }) => measure(requirement, content, whole))
      .filter((m): m is Measurement => m !== null),
    ...(evidence ? [evidence] : []),
  ];
}

/** What it says when a limit could not be counted. */
export const NOT_COUNTED = 'not verified: PromptMaster could not find that part in the saved text, so it was not counted';

/**
 * The limits a stage answers for that code could not count on `content` (4
 * Nov): a named part with no heading of its own. Said as not verified, so a
 * model's estimate is never taken for a count.
 */
export function unverifiedLimits(
  project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'output_format' | 'facts'>>,
  template: WorkflowTemplate,
  stage: StageDefinition,
  content: string
): Measurement[] {
  // A finishing stage may be a short note on the chapters: a part it doesn't hold isn't "not verified".
  if (!content.trim() || finishingStage(template)?.id === stage.id) return [];
  return stageRequirements(project, template, stage)
    .filter(({ requirement, whole }) => measure(requirement, content, whole) === null)
    .map(({ requirement }) => ({ id: `unverified.${requirement.id}`, label: `${requirementLabel(requirement)} — not verified`, satisfied: false, value: NOT_COUNTED }));
}

export type { MeasuredLine };

/** What code counted on `content` for `stage`, and what it could not (4 Nov): handed to every check of it. */
export function measuredLines(
  project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'output_format' | 'facts' | 'code_runs'>>,
  template: WorkflowTemplate,
  stage: StageDefinition,
  content: string,
  prefix = ''
): MeasuredLine[] {
  const name = (label: string) => (prefix ? `${prefix} — ${label}` : label);
  return [
    ...measureStageContent(project, template, stage, content)
      .filter((m) => m.id !== 'measured.evidence')
      .map((m) => ({ label: name(m.label), value: m.value ?? '', met: m.satisfied })),
    ...unverifiedLimits(project, template, stage, content).map((m) => ({ label: name(m.label.replace(/ — not verified$/, '')), value: NOT_COUNTED, met: null })),
  ];
}

/**
 * Results called calculated or verified have something behind them (L-118,
 * 26 Oct): measured in code on a research project's written stages, so a
 * finished stage that fails it is open work and Go repairs it like a word
 * limit. Only research and inquiry work: elsewhere "verified" is as often the
 * story's word as a claim about the work.
 */
export function measureEvidence(
  project: Partial<Pick<Project, 'code_runs'>>,
  template: Pick<WorkflowTemplate, 'key' | 'inquiry'>,
  stage: Pick<StageDefinition, 'renderer'>,
  content: string
): Measurement | null {
  if ((template.key !== 'research' && !template.inquiry) || stage.renderer !== 'prose') return null;
  const claims = unsupportedClaims(content, { codeRuns: project.code_runs?.length ?? 0 });
  const label = 'Results called calculated or verified have the evidence';
  if (!claims.length) return { id: 'measured.evidence', label, satisfied: true, value: 'every such result backed' };
  const detail = describeUnsupported(claims);
  return { id: 'measured.evidence', label, satisfied: false, value: detail, detail };
}

/**
 * Limits on each chapter or section, counted on the text the project delivers. A stage's
 * own checks cover prose stages, and never chapters or a hedged figure, so without this
 * the objective check had nothing but its own reading (6 Nov, a book test: "Roughly
 * 600–800 words per chapter" came back not checked, at 690–787).
 */
export function eachPartMeasurements(
  project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'output_format' | 'facts'>>,
  content: string
): Measurement[] {
  if (!content.trim()) return [];
  return governingRequirements(
    project.objective ?? '',
    parseRequirements([project.objective ?? '', project.constraints ?? '', project.output_format ?? '']),
    currentFacts(project.facts).filter((f) => f.kind === 'requirement').map((f) => parseRequirements([f.statement]))
  )
    .filter((r) => r.per)
    .map((r) => measure(r, content))
    .filter((m): m is Measurement => m !== null);
}

/** The measurable requirements a stage answers for, unmeasured. */
export function stageRequirements(
  project: Pick<Project, 'objective' | 'constraints'> & Partial<Pick<Project, 'output_format' | 'facts'>>,
  template: WorkflowTemplate,
  stage: StageDefinition
): { requirement: MeasurableRequirement; whole: boolean }[] {
  const requirements = governingRequirements(
    project.objective ?? '',
    parseRequirements([project.objective ?? '', project.constraints ?? '', project.output_format ?? '']),
    currentFacts(project.facts).filter((f) => f.kind === 'requirement').map((f) => parseRequirements([f.statement]))
  );
  if (!requirements.length) return [];
  if (finishingStage(template)?.id === stage.id) return requirementsForStage(stage, stage.id, requirements, true);
  return requirementsForStage(stage, deliverableStage(template)?.id, requirements);
}

/**
 * The required prose stage after the chapters, where they are finished into one
 * text (9 Nov, production: "Sponsor update email (no more than 200 words)" was
 * counted on no stage of a package whose last stage held the email, and the
 * check's model counted it by hand). Undefined when chapters are not the deliverable.
 */
function finishingStage(template: WorkflowTemplate): StageDefinition | undefined {
  if (deliverableStage(template)?.renderer !== 'long_form') return undefined;
  const lastLongForm = template.stages.map((s) => s.renderer).lastIndexOf('long_form');
  return template.stages.slice(lastLongForm + 1).reverse().find((s) => s.required && s.renderer === 'prose');
}
