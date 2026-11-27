import { describe, expect, it } from 'vitest';

import { newSinceRoundBegan } from './facts';
import { allowedActions } from './policy';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';

/**
 * L-323 (27 Nov, production passes of the Cedar and payroll rebuilds): on "maintain the records and
 * wait for the next update" projects, Go started round after round with nothing new to take in.
 */
const stage = (id: string, transitions: Record<string, unknown>) =>
  ({ id, label: id, renderer: 'prose', exit_criteria: [], transitions: { allow_skip: false, allow_return_to: [], ...transitions }, expected_artifacts: [{ kind: id, primary: true }] }) as unknown as StageDefinition;
const stages = [
  stage('register', { default_next: 'drafts' }),
  stage('drafts', { default_next: 'round' }),
  stage('round', { loop_to: 'register', default_next: 'packet' }),
  stage('packet', { default_next: null }),
];
const template = (over: Partial<WorkflowTemplate> = {}) => ({ key: 'custom_cedar', stages, ...over }) as unknown as WorkflowTemplate;
const state = { current_stage_id: 'round', stages: { register: { status: 'complete' }, drafts: { status: 'complete' }, round: { status: 'complete' }, packet: { status: 'not_started' } } } as unknown as WorkflowState;

describe('a round with nothing new moves on to the write-up (L-323)', () => {
  it('offers the write-up, not another round, when nothing changed since the round began', () => {
    const keys = allowedActions(template(), state, stages[2], true, undefined, { roundNothingNew: true });
    expect(keys).toContain('advance_stage');
    expect(keys).not.toContain('propose_next_round');
  });

  it('offers the next round when the user changed something since', () => {
    const keys = allowedActions(template(), state, stages[2], true, undefined, { roundNothingNew: false });
    expect(keys).toContain('propose_next_round');
    expect(keys).not.toContain('advance_stage');
  });

  it('keeps research rounds as they were', () => {
    const keys = allowedActions(template({ key: 'research' }), state, stages[2], true, undefined, { roundNothingNew: true });
    expect(keys).toContain('propose_next_round');
  });

  it('reads what is new since the last round began: the user\'s own changes only', () => {
    const ev = (type: string, at: string, over: Record<string, unknown> = {}) => ({ type, actor: 'user', created_at: at, payload: {}, ...over }) as never;
    const began = ev('stage_returned', '2026-11-27T20:00:00Z', { actor: 'system', payload: { next_round: true } });
    expect(newSinceRoundBegan([ev('project_created', '2026-11-27T19:00:00Z'), began])).toBe(false);
    expect(newSinceRoundBegan([began, ev('brief_changed', '2026-11-27T20:05:00Z', { payload: { field: 'facts' } })])).toBe(true);
    expect(newSinceRoundBegan([began, ev('brief_changed', '2026-11-27T20:05:00Z', { actor: 'system', payload: { made_before_change: true } })])).toBe(false);
    expect(newSinceRoundBegan([ev('brief_changed', '2026-11-27T19:30:00Z', { payload: {} }), began])).toBe(false);
    // A change the round's closing stage was rewritten after has been taken in.
    expect(newSinceRoundBegan([began, ev('brief_changed', '2026-11-27T20:05:00Z', { payload: { field: 'facts' } })], '2026-11-27T20:10:00Z')).toBe(false);
    // Before any round: since the project began.
    expect(newSinceRoundBegan([ev('project_created', '2026-11-27T19:00:00Z'), ev('brief_changed', '2026-11-27T19:30:00Z')])).toBe(true);
  });
});
