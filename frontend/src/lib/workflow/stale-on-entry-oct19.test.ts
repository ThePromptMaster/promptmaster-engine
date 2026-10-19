/**
 * 19 Oct (FIELDGUIDE copy, prod): Go went back to Output from Summary, which
 * reopened the skipped Realign. When Output was completed and Go moved on,
 * entering Realign made it "in progress" again, so the stale repair never ran
 * and Go checked Realign's old version twice as if it were the new package.
 */
import { describe, expect, it } from 'vitest';

import { initialState, projectState } from './engine';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowEvent } from './types';
import { allowedActions } from '@/lib/agent/policy';

const ev = (type: WorkflowEvent['type'], stage_id: string, created_at: string, extra: Partial<WorkflowEvent> = {}): WorkflowEvent => ({
  type, stage_id, actor: 'system', created_at, ...extra,
});

const events: WorkflowEvent[] = [
  ev('stage_marked_complete', 'input', '2026-10-19T15:00:00Z', { to_stage_id: 'review' }),
  ev('stage_marked_complete', 'review', '2026-10-19T15:01:00Z', { to_stage_id: 'output' }),
  ev('stage_marked_complete', 'output', '2026-10-19T17:09:08Z', { to_stage_id: 'realign', payload: { evidence_version_id: 'out-v6' } }),
  ev('stage_skipped', 'realign', '2026-10-19T17:09:24Z', { to_stage_id: 'summary' }),
  ev('stage_marked_complete', 'summary', '2026-10-19T17:09:56Z', { payload: { evidence_version_id: 'sum-v3' } }),
  ev('stage_returned', 'summary', '2026-10-19T20:44:00Z', { to_stage_id: 'output', actor: 'user' }),
  ev('stage_marked_complete', 'output', '2026-10-19T21:33:00Z', { to_stage_id: 'realign', payload: { evidence_version_id: 'out-v8' } }),
];

describe('coming back to a skipped stage after an earlier one changed', () => {
  it('Realign stays stale, with its reason, once Go moves on from the new Output', () => {
    const state = projectState(SINGLE_OUTPUT_V1, events);
    expect(state.current_stage_id).toBe('realign');
    expect(state.stages.realign.status).toBe('stale');
    expect(state.stages.realign.stale?.reason).toBe('Output and evaluation changed after this stage was skipped.');
    expect(state.stages.realign.entered_at).toBe('2026-10-19T21:33:00Z');
  });

  it('a stage that was not stale is entered as in progress, as before', () => {
    const state = projectState(SINGLE_OUTPUT_V1, events.slice(0, 3));
    expect(state.stages.realign.status).toBe('in_progress');
  });

  it('a skipped stage entered with nothing earlier changed is simply in progress', () => {
    const state = projectState(SINGLE_OUTPUT_V1, [
      ...events.slice(0, 4),
      ev('stage_returned', 'summary', '2026-10-19T20:44:00Z', { to_stage_id: 'realign', actor: 'user' }),
    ]);
    expect(state.stages.realign.status).toBe('in_progress');
  });

  it('a stale stage stays stale when it is entered', () => {
    const state = projectState(SINGLE_OUTPUT_V1, [
      ...events.slice(0, 3),
      ev('stage_marked_complete', 'realign', '2026-10-19T17:10:00Z', { to_stage_id: 'summary', payload: { evidence_version_id: 're-v1' } }),
      ev('stage_returned', 'summary', '2026-10-19T20:44:00Z', { to_stage_id: 'output', actor: 'user' }),
      ev('stage_marked_complete', 'output', '2026-10-19T21:33:00Z', { to_stage_id: 'realign', payload: { evidence_version_id: 'out-v8' } }),
    ]);
    expect(state.stages.realign.status).toBe('stale');
    expect(state.stages.realign.stale?.reason).toMatch(/went back to Output/);
  });

  it('going back to a stage on purpose still reopens it for work', () => {
    const state = projectState(SINGLE_OUTPUT_V1, events.slice(0, 6));
    expect(state.stages.output.status).toBe('in_progress');
  });
});

describe('a version already checked is not checked again', () => {
  const realign = SINGLE_OUTPUT_V1.stages.find((s) => s.id === 'realign')!;
  const state = initialState(SINGLE_OUTPUT_V1);
  it('offers the check only while the head is unchecked', () => {
    expect(allowedActions(SINGLE_OUTPUT_V1, state, realign, true, undefined, { draft: { truncated: false, checked: false } })).toContain('evaluate_stage');
    const checked = allowedActions(SINGLE_OUTPUT_V1, state, realign, true, undefined, { draft: { truncated: false, checked: true } });
    expect(checked).not.toContain('evaluate_stage');
    expect(checked).toContain('revise_stage');
  });
});
