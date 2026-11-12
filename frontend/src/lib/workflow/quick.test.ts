import { describe, expect, it } from 'vitest';

import { ASSESSMENT_V1, BOOK_V1, EXPLORATION_V1, QUICK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, liveEvents, projectState } from './index';
import { carryTarget, isQuickAnswer, switchBrief } from './quick';
import type { WorkflowEvent } from './types';

const ev = (type: WorkflowEvent['type'], stage_id: string, to_stage_id?: string): WorkflowEvent => ({
  type, stage_id, to_stage_id, actor: 'user', created_at: '2026-10-27T10:00:00Z',
});

describe('Quick answer, then the full process (Sean, 26 Oct)', () => {
  it('is one stage the project opens on, finished when it holds an answer', () => {
    expect(QUICK_V1.stages).toHaveLength(1);
    const state = projectState(QUICK_V1, []);
    expect(state.current_stage_id).toBe('answer');
    expect(QUICK_V1.stages[0].exit_criteria.map((c) => c.rule?.type)).toEqual(['field_non_empty', 'artifact_non_empty']);
    expect(isQuickAnswer(QUICK_V1)).toBe(true);
    expect(isQuickAnswer(SINGLE_OUTPUT_V1)).toBe(false);
  });

  it('projects the new workflow from the events after the switch only', () => {
    const before = [ev('project_created', 'answer'), ev('stage_entered', 'answer'), ev('project_finalized', 'answer')];
    const all = [...before, ev('workflow_switched', 'input')];
    expect(liveEvents(all)).toEqual([]);
    // Nothing replayed: the cursor is where the switch pinned it, the old stage and the finish are gone.
    const state = projectState(SINGLE_OUTPUT_V1, all, 'input');
    expect(state.current_stage_id).toBe('input');
    expect(state.stages.answer).toBeUndefined();
    expect(state.project_status).toBeUndefined();
    // And what happens next counts as usual.
    const on = projectState(SINGLE_OUTPUT_V1, [...all, ev('stage_advanced', 'input', 'review')]);
    expect(on.current_stage_id).toBe('review');
    expect(on.stages.input.status).not.toBe('not_started');
  });

  it('leaves a log with no switch as it was', () => {
    const events = [ev('stage_entered', 'input'), ev('stage_advanced', 'input', 'review')];
    expect(liveEvents(events)).toBe(events);
  });

  it('puts the answer on the stage that holds the deliverable, never on a manuscript', () => {
    expect(carryTarget(SINGLE_OUTPUT_V1)?.id).toBe('output');
    expect(carryTarget(BOOK_V1)).toBeNull();
    for (const t of [RESEARCH_V1, EXPLORATION_V1, ASSESSMENT_V1]) {
      const target = carryTarget(t);
      if (target) expect(t.stages.find((s) => s.id === target.id)?.renderer).toBe('prose');
    }
  });

  it('tells the designer what was asked and what was made', () => {
    const brief = switchBrief('A note to the board', 'Dear board, …');
    expect(brief).toContain('A note to the board');
    expect(brief).toContain('A first draft of the whole piece already exists. Build on it:');
    expect(brief).not.toContain('only its opening fits here');
    expect(switchBrief('Just this', '  ')).toBe('Just this');
  });

  it('says a long draft is finished when only its opening is shown (12 Nov)', () => {
    const long = `${'A day of the plan. '.repeat(400)}THE END.`;
    const brief = switchBrief('An onboarding plan', long);
    expect(brief).toContain('it is finished; only its opening fits here');
    expect(brief).toContain('It is complete, not cut off: nothing has to be continued or supplied.');
    expect(brief).not.toContain('THE END.');
  });
});
