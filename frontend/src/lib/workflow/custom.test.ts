import { describe, expect, it } from 'vitest';

import { designFromTemplate, templateFromDesign, type DesignedWorkflow } from './custom';
import { initialState, projectState } from './engine';
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
