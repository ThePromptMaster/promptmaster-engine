import { describe, expect, it } from 'vitest';

import { latestObjectiveAssessment, objectiveUnmet, pausedLine } from './objective';
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
