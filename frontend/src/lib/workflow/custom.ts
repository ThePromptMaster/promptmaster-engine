/**
 * A workflow the user designed, as a template the engine can walk. Pure.
 *
 * `POST /api/generate-workflow` proposes stages using three page kinds; this
 * turns them into stage definitions with the same parts the system templates
 * have — exit criteria the engine can evaluate, transitions, an artifact kind
 * the renderers know — so nothing downstream learns that it was generated.
 * `validateTemplate` is the check before it is saved.
 */

import type { ExitCriterion, StageDefinition, StageGroup, WorkflowTemplate } from './types';

export type DesignedKind = 'write' | 'list' | 'check';

export interface DesignedStage {
  label: string;
  short_label: string;
  kind: DesignedKind;
  purpose: string;
  instruction: string;
  required: boolean;
  approval: string;
}

export interface DesignedWorkflow {
  name: string;
  description: string;
  deliverable: string;
  inquiry: boolean;
  stages: DesignedStage[];
}

const RENDERER = { write: 'prose', list: 'list', check: 'review' } as const;
/** Kinds the item registry already knows, so a table has real columns and statuses. */
const LIST_KIND = 'research_notes';
const CHECK_KIND = 'critique_report';

export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return /^[a-z]/.test(s) ? s : `s_${s || 'stage'}`;
}

function groupFor(index: number, count: number, kind: DesignedKind): StageGroup {
  if (index === 0) return 'planning';
  if (index === count - 1) return 'final_review';
  return kind === 'check' ? 'evaluation' : 'drafting';
}

function criteriaFor(stage: DesignedStage, id: string, first: boolean): ExitCriterion[] {
  const out: ExitCriterion[] = [];
  if (first) out.push({ id: `${id}.objective`, label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true });
  if (stage.kind === 'write') out.push({ id: `${id}.written`, label: `${stage.label} is written`, check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true });
  if (stage.kind === 'list') out.push({ id: `${id}.items`, label: 'At least one item', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true });
  if (stage.kind === 'check') out.push({ id: `${id}.triaged`, label: 'Every finding accepted or rejected', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: false });
  if (stage.approval.trim()) out.push({ id: `${id}.approved`, label: stage.approval.trim(), check: 'manual', blocking: true });
  return out;
}

/** `suffix` makes the key unique to this user and moment (RLS admits `custom_` keys only). */
export function templateFromDesign(design: DesignedWorkflow, suffix: string): WorkflowTemplate {
  const ids: string[] = [];
  for (const s of design.stages) {
    let id = slug(s.label);
    while (ids.includes(id)) id = `${id}_2`;
    ids.push(id);
  }
  const count = design.stages.length;
  const stages: StageDefinition[] = design.stages.map((s, i) => ({
    id: ids[i],
    label: s.label,
    short_label: s.short_label || s.label.slice(0, 20),
    group: groupFor(i, count, s.kind),
    required: i === 0 || i === count - 1 ? true : s.required,
    renderer: RENDERER[s.kind],
    entry_guidance: s.purpose,
    entry_prompt_hint: s.instruction,
    exit_criteria: criteriaFor(s, ids[i], i === 0),
    expected_artifacts: [{
      kind: s.kind === 'list' ? LIST_KIND : s.kind === 'check' ? CHECK_KIND : `${ids[i]}_text`,
      cardinality: 'one',
      primary: true,
    }],
    recommended_modes: [],
    skip_reasons: i === 0 || i === count - 1 || s.required ? [] : ['Not needed for this piece'],
    transitions: {
      default_next: ids[i + 1] ?? null,
      allow_skip: !(i === 0 || i === count - 1 || s.required),
      allow_return_to: ids.slice(0, i),
    },
  }));
  return {
    key: `custom_${suffix}`,
    version: 1,
    name: design.name.trim() || 'Custom workflow',
    description: design.description.trim(),
    outline_stage: 'none',
    nouns: { deliverable: design.deliverable.trim() || 'piece', unit: 'part' },
    ...(design.inquiry ? { inquiry: true } : {}),
    stages,
  };
}
