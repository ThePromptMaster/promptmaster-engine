import { describe, expect, it } from 'vitest';

import { templateFromDesign, type DesignedWorkflow } from './custom';
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
