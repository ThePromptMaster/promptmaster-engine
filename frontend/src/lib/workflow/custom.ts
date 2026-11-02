/**
 * A workflow the user designed, as a template the engine can walk. Pure.
 *
 * `POST /api/generate-workflow` proposes stages using three page kinds; this
 * turns them into stage definitions with the same parts the system templates
 * have — exit criteria the engine can evaluate, transitions, an artifact kind
 * the renderers know — so nothing downstream learns that it was generated.
 * `validateTemplate` is the check before it is saved.
 */

import { restatesTriage } from './triage-approval';
import type { AssessSpec, ExitCriterion, StageDefinition, StageGroup, WorkflowExecution, WorkflowTemplate } from './types';
import { presetScale, toneAt } from './assess';

/**
 * `chapters` (31 Oct): book-length work, planned as chapters and then written
 * and revised one chapter at a time. Without it a designed book put the whole
 * manuscript in one `write` page, which no single model call can rewrite: a
 * repair was cut off by the length limit twice and Go stopped (Sean, 29–31
 * Oct). It becomes two stages, a chapter plan (the outline editor, approved
 * like Book's) and the chapters themselves (`long_form`), so it runs through
 * Book's own outline, job queue and per-chapter repair.
 */
export type DesignedKind = 'write' | 'list' | 'check' | 'assess' | 'chapters';

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
  /** Assess stages (25 Oct): a preset scale's id, or the user's own levels best first. */
  scale?: string;
  scale_levels?: string[];
  /** Assess stages: what is pasted, plural. */
  item_noun?: string;
}

export interface DesignedWorkflow {
  name: string;
  description: string;
  deliverable: string;
  inquiry: boolean;
  execution?: WorkflowExecution;
  stages: DesignedStage[];
}

const RENDERER = { write: 'prose', list: 'list', check: 'review', assess: 'assess', chapters: 'long_form' } as const;
/** Kinds the item registry already knows, so a table has real columns and statuses. */
const LIST_KIND = 'research_notes';
const CHECK_KIND = 'critique_report';
const ASSESS_KIND = 'assessments';
/** The chapters stage's plan: its id, and how it is named beside the chapters. */
const PLAN_SUFFIX = '_plan';
const PLAN_LABEL = 'Chapter plan';

export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return /^[a-z]/.test(s) ? s : `s_${s || 'stage'}`;
}

function groupFor(index: number, count: number, kind: DesignedKind): StageGroup {
  if (index === 0) return 'planning';
  if (index === count - 1) return 'final_review';
  return kind === 'check' || kind === 'assess' ? 'evaluation' : 'drafting';
}

function criteriaFor(stage: DesignedStage, id: string, first: boolean): ExitCriterion[] {
  const out: ExitCriterion[] = [];
  if (first) out.push({ id: `${id}.objective`, label: 'Objective is stated', check: 'auto', rule: { type: 'field_non_empty', field: 'objective' }, blocking: true });
  if (stage.kind === 'write') out.push({ id: `${id}.written`, label: `${stage.label} is written`, check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true });
  if (stage.kind === 'list') out.push({ id: `${id}.items`, label: 'At least one item', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true });
  if (stage.kind === 'assess') out.push({ id: `${id}.assessed`, label: 'At least one item is assessed', check: 'auto', rule: { type: 'min_items', n: 1 }, blocking: true });
  if (stage.kind === 'chapters') out.push({ id: `${id}.allsections`, label: 'Every chapter is written', check: 'auto', rule: { type: 'all_sections_complete' }, blocking: true });
  // An approval that only restates the automatic check is that check, and
  // blocks as the approval would have (2 Nov, Sean): the table's rows say
  // whether every finding is decided, and a second box in the user's words
  // stopped Go after it had decided them.
  const restated = stage.kind === 'check' && restatesTriage(stage.approval);
  if (stage.kind === 'check') out.push({ id: `${id}.triaged`, label: 'Every finding accepted or rejected', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: restated });
  if (stage.approval.trim() && !restated) {
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
  // The flat list of stages as the engine walks them: a chapters stage is its
  // plan followed by the chapters. Transitions are built on this list.
  const plan = (id: string) => `${id.slice(0, 40 - PLAN_SUFFIX.length)}${PLAN_SUFFIX}`;
  const flatIds = design.stages.flatMap((s, i) => (s.kind === 'chapters' ? [plan(ids[i]), ids[i]] : [ids[i]]));
  const count = design.stages.length;
  const transitionsAt = (id: string, extra: Partial<StageDefinition['transitions']>, skippable: boolean): StageDefinition['transitions'] => {
    const at = flatIds.indexOf(id);
    return {
      default_next: flatIds[at + 1] ?? null,
      allow_skip: skippable,
      allow_return_to: flatIds.slice(0, at),
      ...extra,
    };
  };
  const stages: StageDefinition[] = design.stages.flatMap((s, i): StageDefinition[] => {
    const loop = loopTarget(design, i, ids);
    const skippable = !(i === 0 || i === count - 1 || s.required) && s.kind !== 'chapters';
    const stage: StageDefinition = {
      id: ids[i],
      label: s.label,
      short_label: s.short_label || s.label.slice(0, 20),
      group: groupFor(i, count, s.kind),
      required: i === 0 || i === count - 1 || s.kind === 'chapters' ? true : s.required,
      renderer: RENDERER[s.kind],
      entry_guidance: s.purpose,
      // A stage added by hand with no instructions yet still says what to produce.
      entry_prompt_hint: s.instruction.trim() || `Produce the ${s.label.trim().toLowerCase() || 'stage'}.`,
      exit_criteria: criteriaFor(s, ids[i], i === 0),
      expected_artifacts: [{
        kind: s.kind === 'list' ? LIST_KIND : s.kind === 'check' ? CHECK_KIND : s.kind === 'assess' ? ASSESS_KIND : s.kind === 'chapters' ? 'manuscript' : `${ids[i]}_text`,
        cardinality: 'one',
        primary: true,
      }],
      recommended_modes: [],
      skip_reasons: !skippable ? [] : ['Not needed for this piece'],
      // Ongoing work (7 Oct): the stage that closes a round starts the next
      // from an earlier stage. Only in an ongoing workflow, only backwards.
      transitions: transitionsAt(ids[i], loop ? { loop_to: loop } : {}, skippable),
      ...(s.kind === 'assess' ? { assess: assessSpec(s) } : {}),
    };
    if (s.kind !== 'chapters') return [stage];
    const planId = plan(ids[i]);
    const planStage: StageDefinition = {
      id: planId,
      label: `${s.label.trim().slice(0, 60 - PLAN_LABEL.length - 3)} — ${PLAN_LABEL.toLowerCase()}`,
      short_label: PLAN_LABEL,
      group: 'outlining',
      required: true,
      renderer: 'outline',
      entry_guidance: 'Plan the chapters before writing them: each becomes a chapter that is written, and later revised, on its own.',
      entry_prompt_hint:
        `Produce the ordered chapters of the ${design.deliverable.trim() || 'work'}. Each has a title and a short abstract saying what that chapter does and why it belongs there. ` +
        `The order is the argument: someone reading only the abstracts, in sequence, should see the whole case being built. Stay inside the objective's scope.`,
      exit_criteria: [
        { id: `${planId}.sections`, label: 'The plan has chapters', check: 'auto', rule: { type: 'min_items', n: 2 }, blocking: true, hint: 'Add at least two named chapters — each is written on its own.' },
        { id: `${planId}.approved`, label: 'A chapter plan is approved', check: 'auto', rule: { type: 'outline_approved' }, blocking: true },
      ],
      expected_artifacts: [{ kind: 'outline', cardinality: 'one', primary: true }],
      recommended_modes: [],
      skip_reasons: [],
      transitions: transitionsAt(planId, {}, false),
    };
    return [planStage, stage];
  });
  const hasChapters = design.stages.some((s) => s.kind === 'chapters');
  return {
    key: `custom_${suffix}`,
    version: 1,
    name: design.name.trim() || 'Custom workflow',
    description: design.description.trim(),
    // Book's mode: the plan is a stage of its own, where the outline is built and approved.
    outline_stage: hasChapters ? 'explicit' : 'none',
    nouns: { deliverable: design.deliverable.trim() || 'piece', unit: hasChapters ? 'chapter' : 'part' },
    ...(design.inquiry ? { inquiry: true } : {}),
    ...(design.execution ? { execution: { ...design.execution, success_criterion: design.execution.success_criterion.trim() } } : {}),
    stages,
  };
}

/** The scale a designed assess stage offers: the user's own levels, a preset, or the traffic light. */
function assessSpec(s: DesignedStage): AssessSpec {
  const levels = (s.scale_levels ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 7);
  const scale: AssessSpec['scale'] =
    levels.length >= 2 ? levels.map((label, i) => ({ label, tone: toneAt(i, levels.length) })) : presetScale(s.scale) ? s.scale! : 'traffic';
  return { scale, ...(s.item_noun?.trim() ? { item_noun: s.item_noun.trim() } : {}) };
}

function loopTarget(design: DesignedWorkflow, i: number, ids: readonly string[]): string | null {
  if (design.execution?.kind !== 'ongoing') return null;
  const target = design.stages[i].loop_back_to?.trim();
  if (!target || i === 0 || i === design.stages.length - 1) return null;
  const at = design.stages.findIndex((s) => s.label === target);
  return at >= 0 && at < i ? ids[at] : null;
}

const KIND_OF: Record<string, DesignedKind> = { prose: 'write', list: 'list', review: 'check', assess: 'assess', long_form: 'chapters' };

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
    // A chapter plan is part of the chapters stage after it, not a stage of its own.
    stages: template.stages.filter((s, i) => !(s.renderer === 'outline' && template.stages[i + 1]?.renderer === 'long_form')).map((s) => {
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
        ...(s.assess
          ? typeof s.assess.scale === 'string'
            ? { scale: s.assess.scale, item_noun: s.assess.item_noun ?? '' }
            : { scale_levels: s.assess.scale.map((l) => l.label), item_noun: s.assess.item_noun ?? '' }
          : {}),
      };
    }),
  };
}
