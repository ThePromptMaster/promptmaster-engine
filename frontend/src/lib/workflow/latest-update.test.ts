import { describe, expect, it } from 'vitest';

import type { ProjectTask } from '@/lib/supabase/tasks';
import type { AgentStep } from '@/types/agent';
import { latestUpdate } from './latest-update';
import { stageStatusSummary } from './stage-status';
import type { WorkflowEvent } from './types';

/**
 * Sean, 27 Nov (L-321): "Alex's exception recorded. Draft check blocked. Confirm the current handoff
 * before acting. If an unrelated check is blocked, the UI can show that separately."
 */
const AT = '2026-11-27T19:44:40Z';
const change: WorkflowEvent = {
  type: 'brief_changed', stage_id: 'final', actor: 'user', created_at: AT,
  payload: {
    kind: 'fact', field: 'facts', before: '- CAL-01: Calder calls references.',
    after: '- CAL-01: Calder calls references.\n- Requirement: Calder authorized a one-time exception for Alex Rivera only.',
    affected: [{ stage_id: 'objective', reason: 'x' }, { stage_id: 'final', reason: 'y' }],
  },
};
const step = (over: Partial<AgentStep>): AgentStep => ({ id: 's', run_id: 'r', stage_id: 'final', action_key: 'recheck_stage', params: {}, status: 'succeeded', output: '', started_at: '2026-11-27T19:45:00Z', finished_at: null, ...over } as AgentStep);
const task = (over: Partial<ProjectTask>): ProjectTask => ({ id: 't', user_id: 'u', project_id: 'p', title: 'x', detail: '', stage: 'final', status: 'open', origin: 'system', origin_recommendation_id: null, created_at: '2026-11-27T19:40:00Z', resolved_at: null, ...over });

describe('the latest update (L-321)', () => {
  it('says what was recorded, which check is blocked and that the record is not to be acted on, apart from unrelated blocks', () => {
    const u = latestUpdate({
      events: [change],
      state: { stages: { objective: { status: 'complete' }, final: { status: 'stale', stale: { reason: 'y', since: AT, was: 'complete' } }, linden: { status: 'complete' } } },
      summary: { usable: [{ stageId: 'linden', kept: 'checked' }], redoing: [{ stageId: 'objective', state: 'updated', version: 4, by: 'go' }, { stageId: 'final', state: 'waiting' }], needsYou: [] },
      steps: [
        step({ params: { stage_id: 'objective' }, status: 'failed', output: "Couldn't finish repairing Objective: the new version still gives CAL-01. It is saved.", started_at: '2026-11-27T19:45:24Z' }),
        step({ params: { stage_id: 'objective' }, status: 'succeeded', started_at: '2026-11-27T19:57:20Z' }),
        step({ params: { stage_id: 'final' }, status: 'failed', output: "Couldn't finish repairing Final pack: the new version still gives CAL-01.", started_at: '2026-11-27T19:58:07Z' }),
        step({ stage_id: 'linden', action_key: 'evaluate_stage', status: 'failed', output: 'The check could not run.', started_at: '2026-11-27T19:59:00Z' }),
      ],
      tasks: [
        task({ id: 'a', status: 'dismissed', resolved_by: 'system', resolved_at: '2026-11-27T19:59:30Z' }),
        task({ id: 'b', status: 'done', resolved_by: 'system', resolved_at: '2026-11-27T19:59:31Z' }),
        task({ id: 'c', created_at: '2026-11-27T19:59:32Z' }),
        task({ id: 'd', status: 'dismissed', resolved_by: 'user', resolved_at: '2026-11-27T19:59:33Z' }),
      ],
      onHold: 2,
    })!;
    expect(u.what).toEqual(['Calder authorized a one-time exception for Alex Rivera only.']);
    expect(u.blocked).toEqual([
      { stageId: 'final', reason: "Couldn't finish repairing Final pack: the new version still gives CAL-01.", fromThisChange: true },
      { stageId: 'linden', reason: 'The check could not run.', fromThisChange: false },
    ]);
    expect(u.records).toEqual([
      { stageId: 'objective', state: 'redone', version: 4 },
      { stageId: 'final', state: 'waiting' },
      { stageId: 'linden', state: 'kept' },
    ]);
    expect(u.tasks).toEqual({ done: 1, retired: 1, added: 1, onHold: 2 });
  });

  it('is nothing before any change the user made', () => {
    expect(latestUpdate({ events: [], state: { stages: {} }, summary: null, steps: [], tasks: [], onHold: 0 })).toBeNull();
  });
});

describe('written, checked, approved, done in the world (L-321)', () => {
  const stage = { id: 'finalise', exit_criteria: [{ id: 'finalise.approved', label: 'I approve', check: 'manual', blocking: true }] } as never;
  const versions = [8, 9].map((n) => ({ id: `v${n}`, version_number: n }));

  it("museum: written v9, checked v8, approved v8, B2's delivery still open", () => {
    const line = stageStatusSummary({
      stage, versions, checkedVersionIds: new Set(['v8']), events: [],
      manualChecks: { 'finalise.approved': true }, manualCheckVersions: { 'finalise.approved': 'v8' },
      actionable: [task({ stage: 'finalise', title: 'Deliver carton B2 and record its acceptance.' })],
    });
    expect(line).toEqual({ written: 9, checked: 8, approved: 8, openInWorld: ['Deliver carton B2 and record its acceptance.'], openMore: 0 });
  });

  it("counts Go's re-confirmation after a change as a check, and says nothing when all agree", () => {
    const events = [{ type: 'criterion_committed', stage_id: 'finalise', payload: { reconfirmed: true, evidence_version_id: 'v9' } }] as never;
    const same = stageStatusSummary({ stage, versions, checkedVersionIds: new Set(), events, manualChecks: { 'finalise.approved': true }, manualCheckVersions: { 'finalise.approved': 'v9' }, actionable: [] });
    expect(same).toBeNull();
  });
});

describe('a change with no fact lines still says what changed', () => {
  it('names a refreshed linked project, or the field', () => {
    const ref = { ...change, payload: { field: 'context', kind: 'context', origin: 'reference', reference: { id: 'r', name: 'Harborlight survey' }, affected: [] } } as WorkflowEvent;
    expect(latestUpdate({ events: [ref], state: { stages: {} }, summary: null, steps: [], tasks: [], onHold: 0 })?.what).toEqual(['Harborlight survey changed']);
    const constraints = { ...change, payload: { field: 'constraints', kind: 'constraint', before: 'a', after: 'b', affected: [] } } as WorkflowEvent;
    expect(latestUpdate({ events: [constraints], state: { stages: {} }, summary: null, steps: [], tasks: [], onHold: 0 })?.what).toEqual(['The constraints changed']);
  });
});

describe('changes entered one after another are one update (27 Nov, production pass)', () => {
  it('reads an exception entered as two requirements and a fact as one update', () => {
    const add = (at: string, line: string, prev: string) => ({
      type: 'brief_changed', stage_id: 'final', actor: 'user', created_at: at,
      payload: { kind: 'fact', field: 'facts', before: prev, after: `${prev}\n- ${line}`, affected: [{ stage_id: 'final', reason: 'x' }] },
    }) as WorkflowEvent;
    const events = [
      add('2026-11-27T19:00:00Z', 'Older change.', ''),
      add('2026-11-27T19:44:20Z', 'Requirement: One-time exception for Alex Rivera only.', '- Older change.'),
      add('2026-11-27T19:44:30Z', "Requirement: Alex Rivera's contact sheet stays internal.", '- Older change.\n- Requirement: One-time exception for Alex Rivera only.'),
      add('2026-11-27T19:44:40Z', 'For Alex Rivera, nothing has been sent.', "- Older change.\n- Requirement: One-time exception for Alex Rivera only.\n- Requirement: Alex Rivera's contact sheet stays internal."),
    ];
    const u = latestUpdate({ events, state: { stages: {} }, summary: null, steps: [], tasks: [], onHold: 0 })!;
    expect(u.at).toBe('2026-11-27T19:44:20Z');
    expect(u.what).toEqual(['One-time exception for Alex Rivera only.', "Alex Rivera's contact sheet stays internal.", 'For Alex Rivera, nothing has been sent.']);
  });
});
