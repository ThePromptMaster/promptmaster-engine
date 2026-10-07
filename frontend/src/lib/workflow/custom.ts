/**
 * A workflow the user designed, as a template the engine can walk. Pure.
 *
 * `POST /api/generate-workflow` proposes stages using three page kinds; this
 * turns them into stage definitions with the same parts the system templates
 * have — exit criteria the engine can evaluate, transitions, an artifact kind
 * the renderers know — so nothing downstream learns that it was generated.
 * `validateTemplate` is the check before it is saved.
 */

import type { ExitCriterion, StageDefinition, StageGroup, WorkflowExecution, WorkflowTemplate } from './types';

export type DesignedKind = 'write' | 'list' | 'check';

export interface DesignedStage {
  label: string;
  short_label: string;
  kind: DesignedKind;
  purpose: string;
  instruction: string;
  required: boolean;
  approval: string;
  /** 'routine': checkable against the material, so Go may commit it under the routine-decision policy. */
  approval_kind?: 'routine' | 'decision';
  /** A separate, reserved sign-off on new commitments the stage proposes; '' for none. */
  decision?: string;
  /** Ongoing work: this stage closes a round, and the next starts from the stage with this label. */
  loop_back_to?: string;
}

export interface DesignedWorkflow {
  name: string;
  description: string;
  deliverable: string;
  inquiry: boolean;
  execution?: WorkflowExecution;
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
  if (stage.approval.trim()) {
    // Only an explicit "routine" is delegable; a design from before 6 Oct has
    // no kind and stays the user's.
    const authority = stage.approval_kind === 'routine' ? 'delegable' : 'reserved';
    out.push({ id: `${id}.approved`, label: stage.approval.trim(), check: 'manual', blocking: true, authority });
  }
  if (stage.decision?.trim()) {
    out.push({ id: `${id}.decision`, label: stage.decision.trim(), check: 'manual', blocking: true, authority: 'reserved' });
  }
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
    // A stage added by hand with no instructions yet still says what to produce.
    entry_prompt_hint: s.instruction.trim() || `Produce the ${s.label.trim().toLowerCase() || 'stage'}.`,
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
      // Ongoing work (7 Oct): the stage that closes a round starts the next
      // from an earlier stage. Only in an ongoing workflow, only backwards.
      ...(loopTarget(design, i, ids) ? { loop_to: loopTarget(design, i, ids)! } : {}),
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
    ...(design.execution ? { execution: { ...design.execution, success_criterion: design.execution.success_criterion.trim() } } : {}),
    stages,
  };
}

function loopTarget(design: DesignedWorkflow, i: number, ids: readonly string[]): string | null {
  if (design.execution?.kind !== 'ongoing') return null;
  const target = design.stages[i].loop_back_to?.trim();
  if (!target || i === 0 || i === design.stages.length - 1) return null;
  const at = design.stages.findIndex((s) => s.label === target);
  return at >= 0 && at < i ? ids[at] : null;
}

const KIND_OF: Record<string, DesignedKind> = { prose: 'write', list: 'list', review: 'check' };

/**
 * A saved workflow back as a design, to edit a copy of it (7 Oct; Sean, 6 Oct,
 * email 11: "let users save and reuse their own templates"). Publishing the
 * copy makes a new template; projects on the old one are unaffected.
 */
export function designFromTemplate(template: WorkflowTemplate): DesignedWorkflow {
  const byId = new Map(template.stages.map((s) => [s.id, s.label]));
  return {
    name: template.name,
    description: template.description,
    deliverable: template.nouns?.deliverable ?? 'piece',
    inquiry: Boolean(template.inquiry),
    ...(template.execution ? { execution: template.execution } : {}),
    stages: template.stages.map((s) => {
      const approval = s.exit_criteria.find((c) => c.id.endsWith('.approved') && c.check === 'manual');
      const decision = s.exit_criteria.find((c) => c.id.endsWith('.decision') && c.check === 'manual');
      return {
        label: s.label,
        short_label: s.short_label,
        kind: KIND_OF[s.renderer] ?? 'write',
        purpose: s.entry_guidance ?? '',
        instruction: s.entry_prompt_hint ?? '',
        required: s.required,
        approval: approval?.label ?? '',
        approval_kind: approval?.authority === 'delegable' ? 'routine' : 'decision',
        decision: decision?.label ?? '',
        loop_back_to: s.transitions.loop_to ? (byId.get(s.transitions.loop_to) ?? '') : '',
      };
    }),
  };
}
