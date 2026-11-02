import { describe, expect, it } from 'vitest';

import { designFromTemplate, templateFromDesign, type DesignedWorkflow } from './custom';
import { deliverableStage, initialState, projectState } from './engine';
import { draftingStageId } from './derived-outline';
import { outlineStageFor } from '@/lib/outline/actions';
import { validateTemplate } from './validate';
import type { WorkflowEvent } from './types';

const design: DesignedWorkflow = {
  name: 'Magazine feature', description: 'Pitch to final copy.', deliverable: 'article', inquiry: false,
  stages: [
    { label: 'Pitch and angle', short_label: 'Pitch', kind: 'write', purpose: 'p', instruction: 'State the angle.', required: true, approval: 'I approve this angle' },
    { label: 'Sources', short_label: 'Sources', kind: 'list', purpose: 'p', instruction: 'List people.', required: true, approval: '' },
    { label: 'Fact check', short_label: 'Facts', kind: 'check', purpose: 'p', instruction: 'Check claims.', required: false, approval: '' },
    { label: 'Final copy', short_label: 'Final', kind: 'write', purpose: 'p', instruction: 'Write it.', required: true, approval: '' },
  ],
};

describe('a designed workflow becomes a template the engine can walk (3 Oct call)', () => {
  const t = templateFromDesign(design, 'abc123');

  it('passes the validator a system template passes', () => {
    expect(validateTemplate(t)).toEqual([]);
    expect(t.key).toBe('custom_abc123');
    expect(t.stages.map((s) => s.renderer)).toEqual(['prose', 'list', 'review', 'prose']);
  });

  it('asks for the objective first, and turns an approval into the user’s own box', () => {
    expect(t.stages[0].exit_criteria[0].rule).toEqual({ type: 'field_non_empty', field: 'objective' });
    expect(t.stages[0].exit_criteria.at(-1)).toMatchObject({ label: 'I approve this angle', check: 'manual', blocking: true });
  });

  it('an approval is the user’s unless the design says it is routine; new commitments are always theirs (5 Oct)', () => {
    expect(t.stages[0].exit_criteria.at(-1)).toMatchObject({ authority: 'reserved' });
    const split = templateFromDesign({
      ...design,
      stages: [
        design.stages[0],
        { ...design.stages[1], approval: 'I confirm the extracted terms match the contract', approval_kind: 'routine', decision: 'I accept the new commitments it proposes' },
        design.stages[3],
      ],
    }, 'y');
    const criteria = split.stages[1].exit_criteria.filter((c) => c.check === 'manual');
    expect(criteria.map((c) => [c.label, c.authority])).toEqual([
      ['I confirm the extracted terms match the contract', 'delegable'],
      ['I accept the new commitments it proposes', 'reserved'],
    ]);
    expect(validateTemplate(split)).toEqual([]);
  });

  it('can be walked from the first stage to the last', () => {
    let events: WorkflowEvent[] = [];
    let state = initialState(t);
    for (const s of t.stages.slice(0, -1)) {
      events = [...events, { type: 'stage_completed', stage_id: s.id, to_stage_id: s.transitions.default_next!, actor: 'user', created_at: 'x' }];
      state = projectState(t, events);
    }
    expect(state.current_stage_id).toBe('final_copy');
  });

  it('keeps stage ids unique when two labels match', () => {
    const twice = templateFromDesign({ ...design, stages: [design.stages[0], { ...design.stages[3], label: 'Pitch and angle' }, design.stages[3]] }, 'x');
    expect(new Set(twice.stages.map((s) => s.id)).size).toBe(3);
  });
});

describe('ongoing work and editing a copy (7 Oct)', () => {
  const ongoing: DesignedWorkflow = {
    name: 'Open research', description: '', deliverable: 'research log', inquiry: true,
    execution: { kind: 'ongoing', success_criterion: 'A supported result', stop_conditions: ['a concrete blocker'] },
    stages: [
      { label: 'Objective', short_label: 'Objective', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: '' },
      { label: 'Investigate', short_label: 'Investigate', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: '' },
      { label: 'Next round', short_label: 'Next round', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: '', loop_back_to: 'Investigate' },
      { label: 'Log', short_label: 'Log', kind: 'write', purpose: 'p', instruction: 'i', required: true, approval: 'I accept this log', approval_kind: 'decision' },
    ],
  };

  it('an ongoing design loops from the stage that closes a round, and keeps its success criterion', () => {
    const t = templateFromDesign(ongoing, 'abc');
    expect(t.stages.find((s) => s.id === 'next_round')?.transitions.loop_to).toBe('investigate');
    expect(t.execution).toEqual({ kind: 'ongoing', success_criterion: 'A supported result', stop_conditions: ['a concrete blocker'] });
    expect(validateTemplate(t)).toEqual([]);
  });

  it('a finite design never loops, whatever a stage says', () => {
    const t = templateFromDesign({ ...ongoing, execution: { kind: 'finite', success_criterion: '', stop_conditions: [] } }, 'abc');
    expect(t.stages.some((s) => s.transitions.loop_to)).toBe(false);
  });

  it('a saved workflow comes back as the same design, to edit a copy', () => {
    const back = designFromTemplate(templateFromDesign(ongoing, 'abc'));
    expect(back.execution).toEqual(ongoing.execution);
    expect(back.stages.map((s) => [s.label, s.kind, s.loop_back_to, s.approval, s.approval_kind])).toEqual([
      ['Objective', 'write', '', '', 'decision'],
      ['Investigate', 'write', '', '', 'decision'],
      ['Next round', 'write', 'Investigate', '', 'decision'],
      ['Log', 'write', '', 'I accept this log', 'decision'],
    ]);
  });
});

describe('a designed screening workflow (client, 25 Oct)', () => {
  const stage = (label: string, kind: 'write' | 'assess', extra = {}) => ({
    label, short_label: label, kind, purpose: 'p', instruction: 'i', required: true, approval: '', ...extra,
  });
  const design: DesignedWorkflow = {
    name: 'Candidate screen', description: '', deliverable: 'shortlist', inquiry: false,
    stages: [
      stage('Criteria', 'write', { approval: 'I approve these criteria' }),
      stage('Screen profiles', 'assess', { scale: 'score5', item_noun: 'profiles' }),
      stage('Own scale', 'assess', { scale_levels: ['Strong yes', 'Yes', 'No'] }),
      stage('Shortlist', 'write'),
    ],
  };

  it('becomes assess stages with their scale, and walks', () => {
    const t = templateFromDesign(design, 'x1');
    expect(validateTemplate(t)).toEqual([]);
    const [, screen, own] = t.stages;
    expect(screen).toMatchObject({ renderer: 'assess', assess: { scale: 'score5', item_noun: 'profiles' }, expected_artifacts: [{ kind: 'assessments' }] });
    expect(own.assess?.scale).toEqual([
      { label: 'Strong yes', tone: 'good' }, { label: 'Yes', tone: 'caution' }, { label: 'No', tone: 'bad' },
    ]);
    // Edited as a copy, the scale comes back.
    expect(designFromTemplate(t).stages.slice(1, 3).map((s) => [s.kind, s.scale ?? '', s.scale_levels ?? []])).toEqual([
      ['assess', 'score5', []], ['assess', '', ['Strong yes', 'Yes', 'No']],
    ]);
  });
});

describe('a designed book is written a chapter at a time (31 Oct)', () => {
  // Sean, 29–31 Oct: "Book manuscript" was one prose page holding the whole
  // book; a repair was cut off by the length limit twice and Go stopped.
  const stage = (label: string, kind: 'write' | 'list' | 'chapters', extra = {}) => ({
    label, short_label: label.slice(0, 20), kind, purpose: 'p', instruction: 'Write each chapter in full.', required: true, approval: '', ...extra,
  });
  const book: DesignedWorkflow = {
    name: 'Nonfiction book', description: '', deliverable: 'book', inquiry: true,
    stages: [stage('Book brief', 'write'), stage('Evidence base', 'list'), stage('Book manuscript', 'chapters'), stage('Assemble', 'write')],
  };
  const t = templateFromDesign(book, 'bk1');

  it('becomes a chapter plan the user approves, then the chapters, and validates', () => {
    expect(validateTemplate(t)).toEqual([]);
    expect(t.outline_stage).toBe('explicit');
    expect(t.stages.map((s) => [s.id, s.renderer])).toEqual([
      ['book_brief', 'prose'], ['evidence_base', 'list'], ['book_manuscript_plan', 'outline'], ['book_manuscript', 'long_form'], ['assemble', 'prose'],
    ]);
    const plan = t.stages[2];
    expect(plan.exit_criteria.map((c) => c.rule?.type)).toEqual(['min_items', 'outline_approved']);
    expect(plan.transitions.default_next).toBe('book_manuscript');
    expect(t.stages[3].exit_criteria.map((c) => c.rule?.type)).toContain('all_sections_complete');
    expect(t.stages[3].transitions.allow_return_to).toContain('book_manuscript_plan');
    expect(t.stages[1].transitions.default_next).toBe('book_manuscript_plan');
  });

  it('is where chapters are drafted and the outline is built, as in Book', () => {
    expect(draftingStageId(t)).toBe('book_manuscript');
    expect(outlineStageFor(t)?.id).toBe('book_manuscript_plan');
    expect(deliverableStage(t)?.id).toBe('book_manuscript');
  });

  it('comes back as one chapters stage when a copy is edited', () => {
    expect(designFromTemplate(t).stages.map((s) => [s.label, s.kind])).toEqual([
      ['Book brief', 'write'], ['Evidence base', 'list'], ['Book manuscript', 'chapters'], ['Assemble', 'write'],
    ]);
  });

  it('a chapters page with no plan before it does not validate', () => {
    const broken = { ...t, stages: t.stages.filter((s) => s.renderer !== 'outline').map((s) => ({ ...s, transitions: { ...s.transitions, default_next: s.transitions.default_next === 'book_manuscript_plan' ? 'book_manuscript' : s.transitions.default_next, allow_return_to: s.transitions.allow_return_to.filter((id) => id !== 'book_manuscript_plan') } })) };
    expect(validateTemplate(broken).join(' ')).toMatch(/chapter plan must come before it/);
  });
});

describe('a Check stage whose approval only restates the triage (2 Nov, Sean)', () => {
  const withApproval = (approval: string): DesignedWorkflow => ({
    ...design,
    stages: design.stages.map((s) => (s.kind === 'check' ? { ...s, approval, approval_kind: 'routine' as const } : s)),
  });

  it('becomes the automatic check, blocking as the approval would have', () => {
    const t = templateFromDesign(withApproval('I have accepted or rejected each finding'), 'r1');
    const c = t.stages[2].exit_criteria;
    expect(c.map((x) => x.id)).toEqual(['fact_check.triaged']);
    expect(c[0]).toMatchObject({ check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: true });
    expect(validateTemplate(t)).toEqual([]);
  });

  it('keeps an approval about what the check concludes, and the triage stays optional', () => {
    const t = templateFromDesign(withApproval('I confirm the memo meets every requirement'), 'r2');
    const c = t.stages[2].exit_criteria;
    expect(c.map((x) => x.id)).toEqual(['fact_check.triaged', 'fact_check.approved']);
    expect(c[0].blocking).toBe(false);
  });
});
