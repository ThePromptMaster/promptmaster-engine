/**
 * Stages added to a project while it runs (25 Oct, Sean: Go named the next
 * calculation, "Two-interval Rényi-2 calculation (P1)", wrote it into the
 * report as a new stage, and could not make it one — "document revision cannot
 * add a workflow stage or change which stage is active"). Pure.
 *
 * A pinned template version stays immutable. What the project adds is a
 * `stage_added` event carrying the stage's design, and `effectiveTemplate`
 * is the pinned template with those stages put in place — the one template
 * every reader (rail, projection, outstanding work, digest, Go) is given, so
 * no renderer or rule learns that a stage was added.
 */

import type { ExitCriterion, StageDefinition, WorkflowEvent, WorkflowTemplate } from './types';

export type AddedStageKind = 'write' | 'list' | 'check';

/** What `stage_added` carries in its payload, as `payload.stage`. */
export interface AddedStage {
  id: string;
  label: string;
  short_label: string;
  kind: AddedStageKind;
  /** Why the stage exists: what it is to settle. */
  purpose: string;
  /** What to produce, as the generator is told. */
  instruction: string;
  /** The stage it comes after. */
  after: string;
}

/** At most this many stages Go adds in one run (the user chose a cap, 25 Oct). */
export const MAX_ADDED_PER_RUN = 3;

const RENDERER = { write: 'prose', list: 'list', check: 'review' } as const;

function criteria(stage: AddedStage): ExitCriterion[] {
  const id = stage.id;
  if (stage.kind === 'list') return [{ id: `${id}.items`, label: 'At least one item', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true }];
  if (stage.kind === 'check') return [{ id: `${id}.triaged`, label: 'Every finding accepted or rejected', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: false }];
  return [{ id: `${id}.written`, label: `${stage.label} is written`, check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true }];
}

export function addedStageDefinition(stage: AddedStage): StageDefinition {
  return {
    id: stage.id,
    label: stage.label,
    short_label: stage.short_label || stage.label.slice(0, 20),
    group: stage.kind === 'check' ? 'evaluation' : 'drafting',
    required: false,
    renderer: RENDERER[stage.kind],
    entry_guidance: stage.purpose,
    entry_prompt_hint: stage.instruction.trim() || `Produce the ${stage.label.trim().toLowerCase()}.`,
    exit_criteria: criteria(stage),
    expected_artifacts: [{
      kind: stage.kind === 'list' ? 'research_notes' : stage.kind === 'check' ? 'critique_report' : `${stage.id}_text`,
      cardinality: 'one',
      primary: true,
    }],
    recommended_modes: [],
    skip_reasons: ['Not needed any more'],
    transitions: { default_next: null, allow_skip: true, allow_return_to: [] },
    added: true,
  };
}

/** The stage design on a `stage_added` event, or null for one this code cannot read. */
export function addedStageOf(event: Pick<WorkflowEvent, 'type' | 'payload'>): AddedStage | null {
  if (event.type !== 'stage_added') return null;
  const s = event.payload?.stage as Partial<AddedStage> | undefined;
  if (!s || typeof s.id !== 'string' || typeof s.label !== 'string' || typeof s.after !== 'string') return null;
  const kind = s.kind === 'list' || s.kind === 'check' ? s.kind : 'write';
  return {
    id: s.id, label: s.label, short_label: typeof s.short_label === 'string' ? s.short_label : '',
    kind, purpose: typeof s.purpose === 'string' ? s.purpose : '', instruction: typeof s.instruction === 'string' ? s.instruction : '',
    after: s.after,
  };
}

/**
 * The pinned template with the project's added stages in place. The same
 * object comes back when nothing was added, so callers can memoise on it.
 */
export function effectiveTemplate(template: WorkflowTemplate, events: readonly Pick<WorkflowEvent, 'type' | 'payload'>[] | null | undefined): WorkflowTemplate {
  const added = (events ?? []).map(addedStageOf).filter((s): s is AddedStage => s !== null);
  if (!added.length) return template;
  const stages = template.stages.map((s) => ({ ...s, transitions: { ...s.transitions } }));
  for (const a of added) {
    if (stages.some((s) => s.id === a.id)) continue;
    const at = stages.findIndex((s) => s.id === a.after);
    if (at < 0) continue;
    const def = addedStageDefinition(a);
    const prev = stages[at];
    def.transitions = {
      ...def.transitions,
      default_next: prev.transitions.default_next ?? stages[at + 1]?.id ?? null,
      allow_return_to: stages.slice(0, at + 1).map((s) => s.id),
    };
    prev.transitions.default_next = def.id;
    stages.splice(at + 1, 0, def);
  }
  return { ...template, stages };
}

/**
 * Where a new stage goes: after the stage the work is on, but never after the
 * last stage — that stage writes the deliverable, which the new work feeds,
 * so the new stage goes just before it and the deliverable is rechecked
 * from its results.
 */
export function placementFor(template: WorkflowTemplate, currentStageId: string): string {
  const ids = template.stages.map((s) => s.id);
  const at = ids.indexOf(currentStageId);
  const last = ids.length - 1;
  if (at < 0 || at >= last) return ids[Math.max(0, last - 1)];
  return currentStageId;
}

/** A stage id not yet used in the template, from the stage's name. */
export function newStageId(template: WorkflowTemplate, label: string): string {
  const base = `added_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'stage'}`;
  let id = base;
  for (let n = 2; template.stages.some((s) => s.id === id); n += 1) id = `${base}_${n}`;
  return id;
}

/** The stage to add, from what the work named, placed for the template as it is now. */
export function designAddedStage(
  template: WorkflowTemplate,
  currentStageId: string,
  wanted: { title: string; kind?: string; work?: string; purpose?: string }
): AddedStage {
  const label = wanted.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Next task';
  return {
    id: newStageId(template, label),
    label,
    short_label: label.length > 24 ? `${label.slice(0, 23).trimEnd()}…` : label,
    kind: wanted.kind === 'list' || wanted.kind === 'check' ? wanted.kind : 'write',
    purpose: (wanted.purpose ?? wanted.work ?? '').trim().slice(0, 600),
    instruction: (wanted.work ?? '').trim().slice(0, 1_500),
    after: placementFor(template, currentStageId),
  };
}

/** How many stages this run has added. */
export function addedByRun(events: readonly Pick<WorkflowEvent, 'type' | 'agent_run_id'>[], runId: string): number {
  return events.filter((e) => e.type === 'stage_added' && e.agent_run_id === runId).length;
}

/** A key that changes only when a stage is added: what `effectiveTemplate` depends on. */
export function addedSignature(events: readonly Pick<WorkflowEvent, 'type' | 'payload'>[] | null | undefined): string {
  return (events ?? []).map(addedStageOf).filter((s): s is AddedStage => s !== null).map((s) => `${s.id}@${s.after}`).join('|');
}
