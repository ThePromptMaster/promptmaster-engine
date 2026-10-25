/**
 * 25 Oct (Sean, quantum gravity): Go named the next calculation, proposed it
 * as a new stage in the report, and could not make it one. A project now adds
 * stages while it runs; the pinned template version is untouched.
 */
import { describe, expect, it } from 'vitest';

import { addedByRun, designAddedStage, effectiveTemplate, placementFor } from './added-stages';
import { laterDoneStages, projectState } from './engine';
import { executableNext, objectiveUnmet, openWithNextLine } from './objective';
import { RESEARCH_V1 } from './templates/research.v1';
import type { WorkflowEvent } from './types';
import { validateTemplate } from './validate';

const ids = RESEARCH_V1.stages.map((s) => s.id);
const last = ids[ids.length - 1];
const before = ids[ids.length - 2];
const doneUpTo = (n: number): WorkflowEvent[] =>
  ids.slice(0, n).map((id, i) => ({
    type: 'stage_marked_complete', stage_id: id, actor: 'user', to_stage_id: ids[i + 1],
    created_at: `2026-10-25T10:${String(i).padStart(2, '0')}:00Z`, payload: { evidence_version_id: `v-${id}` },
  }));

describe('a stage added while the project runs', () => {
  const design = designAddedStage(RESEARCH_V1, last, { title: 'Two-interval Rényi-2 calculation (P1)', kind: 'write', work: 'Compute S2 for two intervals in the free boson CFT.' });
  const added: WorkflowEvent = {
    type: 'stage_added', stage_id: design.id, actor: 'system', agent_run_id: 'run-1', reason: 'Next task.',
    created_at: '2026-10-25T11:00:00Z', payload: { stage: design, activate: true },
  };

  it('goes just before the stage that writes the deliverable when the work is on that stage', () => {
    expect(placementFor(RESEARCH_V1, last)).toBe(before);
    expect(placementFor(RESEARCH_V1, ids[1])).toBe(ids[1]);
    expect(design.after).toBe(before);
  });

  it('is put in place, with transitions through it, and the template stays valid', () => {
    const t = effectiveTemplate(RESEARCH_V1, [added]);
    const order = t.stages.map((s) => s.id);
    expect(order.indexOf(design.id)).toBe(order.indexOf(before) + 1);
    expect(order.at(-1)).toBe(last);
    expect(t.stages.find((s) => s.id === before)!.transitions.default_next).toBe(design.id);
    expect(t.stages.find((s) => s.id === design.id)!.transitions.default_next).toBe(last);
    expect(validateTemplate(t)).toEqual([]);
    // The pinned version is untouched.
    expect(RESEARCH_V1.stages.map((s) => s.id)).toEqual(ids);
    expect(effectiveTemplate(RESEARCH_V1, [])).toBe(RESEARCH_V1);
  });

  it('is entered, and its first saved version reopens the deliverable for a recheck', () => {
    const t = effectiveTemplate(RESEARCH_V1, [added]);
    const events = [...doneUpTo(ids.length), added];
    const state = projectState(t, events);
    expect(state.current_stage_id).toBe(design.id);
    expect(state.stages[design.id].status).toBe('in_progress');
    expect(laterDoneStages(t, state, design.id)).toContain(last);
  });

  it('counts what a run added', () => {
    expect(addedByRun([added, { ...added, agent_run_id: 'other' }], 'run-1')).toBe(1);
  });
});

describe('an open objective with a next task that can be done now', () => {
  const base = { outcome: 'not_met' as const, blockers: [{ need: 'The PDFs of the two 2023 papers', kind: 'source_missing' as const }] };

  it('is executable when the task needs nothing missing, whatever else is', () => {
    const next = executableNext({ ...base, next_task: { title: 'Two-interval Rényi-2', kind: 'write', work: 'Compute it.', needs: [] } });
    expect(next?.title).toBe('Two-interval Rényi-2');
    expect(openWithNextLine(base, next!)).toMatch(/Missing, but not needed for it: The PDFs/);
  });

  it('is not when the task needs a missing item, or the objective is met', () => {
    expect(executableNext({ ...base, next_task: { title: 'X', kind: 'write', work: '', needs: ['The PDFs of the two 2023 papers'] } })).toBeNull();
    expect(executableNext({ outcome: 'met', next_task: { title: 'X', kind: 'write', work: '', needs: [] } })).toBeNull();
  });

  it('a stage added after the pause makes the pause one to check again', () => {
    const assessed: WorkflowEvent = { type: 'objective_assessed', stage_id: last, actor: 'system', created_at: '2026-10-25T10:00:00Z', payload: { ...base, reason: 'r', basis_quote: '', performed: [], proposed_next: [] } };
    expect(objectiveUnmet([assessed])).not.toBeNull();
    expect(objectiveUnmet([assessed, { type: 'stage_added', stage_id: 'added_x', actor: 'user', created_at: '2026-10-25T10:05:00Z' }])).toBeNull();
  });
});
