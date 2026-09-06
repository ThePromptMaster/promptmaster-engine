/**
 * Deriving an outline from work already done (FR-07).
 *
 * `outline_stage: 'derived'` was declared in the template type, round-tripped
 * through Supabase and asserted in two tests, and read by no logic anywhere. A
 * Research project therefore planned itself across twelve stages and arrived at
 * drafting with an empty outline, no approved version, and a disabled button.
 * This module is what the flag now means.
 *
 * Pure, and deliberately so. No model call, for the same two reasons exit
 * criteria have none: an outline that comes back different every time you look
 * at it is not a plan, and a plan that fails because a model timed out is a
 * plan users learn to route around. A paper's section structure is a convention
 * of the form; the only thing worth generating is the prose that goes in it.
 *
 * The output is an ordinary `OutlineDocument` — the same shape Book's editor
 * produces. Downstream of this file nothing knows a derived outline from a
 * hand-built one, which is what lets Research reuse the outline editor, the
 * approval event, the job queue and FR-05 resumption without a second path.
 */

import { summariseStageContent } from './digest';
import type { StageArtifactBundle } from './digest';
import type {
  DerivedSectionSpec,
  StageDefinition,
  WorkflowState,
  WorkflowTemplate,
} from './types';
import { emptyDocument } from '@/lib/outline/model';
import type { OutlineDocument, OutlineItem } from '@/types/outline';

/** One source stage's contribution, before it is folded into an abstract. */
export interface SectionSource {
  stage_id: string;
  label: string;
  brief: string;
}

export interface DerivedSection {
  id: string;
  title: string;
  guidance: string;
  sources: SectionSource[];
  /** True when no source stage contributed anything. */
  empty: boolean;
}

/**
 * What one stage has to say for itself, or '' if nothing.
 *
 * The same rule as `buildStageDigest`, and for the same reason: only stages the
 * user actually completed contribute. A skipped stage reached no conclusion and
 * a stale one is by definition no longer trusted, so briefing a section off
 * either would have the draft build on something already walked away from.
 *
 * The stored summary wins where there is one — it was written when the stage
 * completed, so a later edit upstream cannot silently rewrite the brief a
 * section was drafted against. Projects predating stored summaries fall back to
 * projecting the head version, rather than producing nothing.
 */
export function stageBrief(
  stage: StageDefinition,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>
): string {
  if (state.stages[stage.id]?.status !== 'complete') return '';
  const bundle = bundles[stage.id];
  const stored = bundle?.artifact?.summary?.trim();
  if (stored) return stored;
  return summariseStageContent(stage, bundle?.versions.at(-1)?.content ?? '');
}

/**
 * Fold a spec section and its stages into the section as it will appear.
 *
 * Kept separate from item construction so the drift check can compare briefs
 * without going through serialisation.
 */
function deriveSection(
  spec: DerivedSectionSpec,
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>
): DerivedSection {
  const sources: SectionSource[] = [];
  for (const stageId of spec.from_stages) {
    const stage = template.stages.find((s) => s.id === stageId);
    if (!stage) continue;
    const brief = stageBrief(stage, state, bundles);
    if (!brief) continue;
    sources.push({ stage_id: stage.id, label: stage.label, brief });
  }
  return {
    id: spec.id,
    title: spec.title,
    guidance: spec.guidance,
    sources,
    empty: sources.length === 0,
  };
}

/**
 * The abstract a drafting job is given.
 *
 * Guidance first, because it holds whatever the source stages did not: a
 * section whose stage was skipped still says what it is for. The briefs follow,
 * labelled by the stage they came from, so a reader of the outline can see
 * which work each section is answerable to.
 */
export function sectionAbstract(section: DerivedSection): string {
  if (section.empty) return section.guidance;
  const briefs = section.sources.map((s) => `${s.label}: ${s.brief}`).join('\n');
  return `${section.guidance}\n\n${briefs}`;
}

export interface DeriveOptions {
  /**
   * Keep optional sections whose sources produced nothing. Off by default —
   * the drafting gate is `all_sections_complete`, so an empty section is a
   * heading the user must either write under or delete before they can leave.
   */
  keepEmptyOptional?: boolean;
}

/** The sections that survive, in template order. */
export function deriveSections(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  options: DeriveOptions = {}
): DerivedSection[] {
  const spec = template.derived_outline;
  if (template.outline_stage !== 'derived' || !spec) return [];

  return spec.sections
    .map((s) => ({ spec: s, derived: deriveSection(s, template, state, bundles) }))
    .filter(({ spec: s, derived }) => s.required || options.keepEmptyOptional || !derived.empty)
    .map(({ derived }) => derived);
}

/**
 * Item ids come from the spec, not from `newItemId()`.
 *
 * That is what makes re-derivation safe. Ids are the lineage binding prose to
 * an outline item, so a second derivation after an upstream edit lands on the
 * same ids and every written section stays attached to its heading. Minting
 * fresh ids would orphan the whole manuscript on the first upstream typo.
 */
export function deriveOutlineItems(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  options: DeriveOptions = {}
): OutlineItem[] {
  return deriveSections(template, state, bundles, options).map((section) => ({
    id: section.id,
    title: section.title,
    abstract: sectionAbstract(section),
  }));
}

export function deriveOutlineDocument(
  template: WorkflowTemplate,
  state: WorkflowState,
  bundles: Record<string, StageArtifactBundle>,
  options: DeriveOptions = {}
): OutlineDocument {
  return { ...emptyDocument(), items: deriveOutlineItems(template, state, bundles, options) };
}

// --- staleness --------------------------------------------------------------

export interface DerivedOutlineDrift {
  /** Sections whose brief changed because their source stage changed. */
  changed: OutlineItem[];
  /** Sections a stage now supports that were not there when this was approved. */
  added: OutlineItem[];
  /** Sections whose sources have gone; their prose is never discarded. */
  removed: OutlineItem[];
  stale: boolean;
}

/**
 * Has upstream moved since this outline was approved?
 *
 * The analogue of `staleDrafts`, and answered the same way: report it, name
 * what moved, and leave the decision with the person who did the work. A
 * derived outline is a starting point and an approved one is a commitment;
 * silently re-deriving over an approved outline would pull the plan out from
 * under a half-written paper, which is the exact class of failure FR-05 exists
 * to prevent.
 */
export function derivedOutlineDrift(
  approved: OutlineItem[],
  fresh: OutlineItem[]
): DerivedOutlineDrift {
  const approvedById = new Map(approved.map((i) => [i.id, i]));
  const freshById = new Map(fresh.map((i) => [i.id, i]));

  const changed = fresh.filter((item) => {
    const was = approvedById.get(item.id);
    return was !== undefined && (was.abstract !== item.abstract || was.title !== item.title);
  });
  const added = fresh.filter((item) => !approvedById.has(item.id));
  const removed = approved.filter((item) => !freshById.has(item.id));

  return {
    changed,
    added,
    removed,
    stale: changed.length > 0 || added.length > 0 || removed.length > 0,
  };
}

/**
 * The stage an approved outline is written *for*: the first stage that drafts.
 *
 * For a derived outline this is the stage the panel already sits on, so caller
 * and destination coincide. For Book's explicit Outline stage it is a later
 * stage entirely — and writing `long_form` onto the outline stage's own
 * artifact would leave drafting reporting "0 of 0 sections" with an approval
 * sitting in the event log saying otherwise. That mismatch is exactly why
 * Book's outline stage could not be wired up by dispatching a renderer alone.
 *
 * First rather than only: Book has several `long_form` stages (drafting, then
 * the expansion passes). Sections are materialised once, by the first.
 */
export function draftingStageId(template: WorkflowTemplate): string | null {
  return template.stages.find((s) => s.renderer === 'long_form')?.id ?? null;
}
