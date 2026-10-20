import { describe, expect, it } from 'vitest';

import { latestObjectiveAssessment, objectiveUnmet, pausedLine, goWaitingLine, OBJECTIVE_CHANGES } from './objective';
import type { WorkflowEvent } from './types';

const assessed = (outcome: string, created_at: string, blockers: { need: string; kind: string }[] = []): WorkflowEvent => ({
  type: 'objective_assessed', stage_id: 'final', actor: 'system', created_at,
  payload: { outcome, reason: `r-${outcome}`, basis_quote: '', blockers, performed: [], proposed_next: [] },
});

describe('the objective as judged (7 Oct)', () => {
  it('reads the latest assessment, and only "not met" or "partly" is unmet', () => {
    const notMet = assessed('not_met', '1', [{ need: 'the exact formulas', kind: 'source_missing' }]);
    expect(objectiveUnmet([notMet])?.blockers[0].need).toBe('the exact formulas');
    expect(objectiveUnmet([notMet, assessed('met', '2')])).toBeNull();
    expect(latestObjectiveAssessment([assessed('met', '1'), assessed('partly', '2')])?.outcome).toBe('partly');
    expect(objectiveUnmet([])).toBeNull();
  });

  it('says what the pause waits for', () => {
    expect(pausedLine({ reason: 'x', blockers: [{ need: 'the formulas', kind: 'source_missing' }, { need: 'the data', kind: 'data_missing' }] }))
      .toBe('Paused — the objective is not met. Waiting for: the formulas; the data.');
    expect(pausedLine({ reason: 'the log says it is not met', blockers: [] })).toBe('The objective is not met yet: the log says it is not met');
  });

  it('an answer, a fact or a change after the verdict makes it a thing to check again (Sean, 7 Oct, email 11)', () => {
    const waiting = assessed('not_met', '2026-10-07T10:00:00Z', [
      { need: 'your decision on the launch date', kind: 'needs_decision' },
      { need: 'your decision on the price', kind: 'needs_decision' },
    ]);
    expect(objectiveUnmet([waiting], [{ created_at: '2026-10-07T09:00:00Z' }])).not.toBeNull();
    expect(objectiveUnmet([waiting], [{ created_at: '2026-10-07T10:05:00Z' }])).toBeNull();
    const unblocked: WorkflowEvent = { type: 'stage_unblocked', stage_id: 'summary', actor: 'user', created_at: '2026-10-07T10:06:00Z' };
    expect(objectiveUnmet([waiting, unblocked])).toBeNull();
    const saved: WorkflowEvent = { type: 'stage_version_saved', stage_id: 'output', actor: 'user', created_at: '2026-10-07T10:06:00Z' };
    expect(objectiveUnmet([waiting, saved])).toBeNull();
  });
});

describe('stillMet (11 Oct: four checks of an unchanged Output v2)', () => {
  const basis = { stage_id: 'output', stage_label: 'Output', version_id: 'v2', version_number: 2, measured: [], assessed: [], not_checked: [] };
  const met = { type: 'objective_assessed', created_at: '2026-10-11T10:00:00Z', payload: { outcome: 'met', reason: 'ok', basis_quote: 'q', blockers: [], performed: [], proposed_next: [], basis } } as never;
  it('keeps a met verdict on the same version with nothing changed', async () => {
    const { stillMet } = await import('./objective');
    expect(stillMet([met], [], { stageId: 'output', versionId: 'v2' })?.basis.version_id).toBe('v2');
  });
  it('not on another version, after a save of the deliverable, a brief change or a new fact', async () => {
    const { stillMet } = await import('./objective');
    expect(stillMet([met], [], { stageId: 'output', versionId: 'v3' })).toBeNull();
    const saved = { type: 'stage_version_saved', stage_id: 'output', created_at: '2026-10-11T10:05:00Z' } as never;
    expect(stillMet([met, saved], [], { stageId: 'output', versionId: 'v2' })).toBeNull();
    const elsewhere = { type: 'stage_version_saved', stage_id: 'summary', created_at: '2026-10-11T10:05:00Z' } as never;
    expect(stillMet([met, elsewhere], [], { stageId: 'output', versionId: 'v2' })).not.toBeNull();
    expect(stillMet([met], [{ created_at: '2026-10-11T10:06:00Z' }], { stageId: 'output', versionId: 'v2' })).toBeNull();
  });
});

describe('one blocker said once, and gone when resolved (13 Oct, Sean, workshop)', () => {
  const stop = 'Paused — the objective is not met. Waiting for: a revised lunch plan that fits 20 lunches within the approved $240 budget.';
  it('says nothing beside the objective\'s own item, and only "resume" once it is out of date', () => {
    expect(goWaitingLine(stop, true)).toBeNull();
    expect(goWaitingLine(stop, false)).toBe('resume Go to check the objective again');
    expect(goWaitingLine('Approve the analysis plan?', true)).toBe('Approve the analysis plan?');
    expect(goWaitingLine(null, true)).toBeNull();
  });
  it('a later answer or new version clears the pause, as the projects list reads it', () => {
    const assessed = { type: 'objective_assessed', stage_id: 'summary', actor: 'system', created_at: '2026-10-14T01:53:14Z', payload: { outcome: 'not_met', blockers: [{ need: 'lunch', kind: 'source_missing' }] } } as WorkflowEvent;
    expect(objectiveUnmet([assessed])).not.toBeNull();
    for (const type of OBJECTIVE_CHANGES) {
      expect(objectiveUnmet([assessed, { type, stage_id: 'output', actor: 'user', created_at: '2026-10-14T01:58:00Z' } as WorkflowEvent])).toBeNull();
    }
  });
});

describe('a round check read back from the log (20 Oct, prod pass)', () => {
  const round = (extra: Record<string, unknown>): WorkflowEvent => ({
    type: 'objective_assessed', stage_id: 'next_round', actor: 'system', created_at: '1',
    payload: { outcome: 'not_met', reason: 'Nothing in this work is left for you.', basis_quote: '', blockers: [], performed: [], proposed_next: [], ...extra },
  });

  it('keeps the limitations it carried, for the pause card', () => {
    const lim = [{ item: 'No legal invoices', allowed_by: 'Record missing evidence as limitations.' }];
    expect(latestObjectiveAssessment([round({ limitations: lim })])?.limitations).toEqual(lim);
    expect(objectiveUnmet([round({ limitations: lim })])?.limitations).toEqual(lim);
  });

  it('is not a pause when the round was ready for the stage that writes the deliverable', () => {
    expect(objectiveUnmet([round({ ready_for_later_stage: true })])).toBeNull();
  });
});
