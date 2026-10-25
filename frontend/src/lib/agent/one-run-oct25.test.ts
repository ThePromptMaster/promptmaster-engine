/**
 * Sean, 24–25 Oct: a phone showed "duplicate key value violates unique
 * constraint agent_runs_one_running_per_project" beside "This run is being
 * driven from another tab", and an iPad run stopped on the ID question with
 * "Do whatever is best" typed into it by hand.
 */
import { describe, expect, it } from 'vitest';
import { drivenElsewhere, isDuplicateRun, routineConflictAnswer, LEASE_STALE_MS } from '@/components/workflow/use-go-loop';
import { answerAsFact, DELEGATED_ANSWER } from '@/lib/workflow/answers';
import { idChangeDefault } from '@/lib/workflow/id-changes';
import { ROUTINE_DEFAULT_STEP } from '@/lib/agent/actions';
import type { AgentStep } from '@/types/agent';

describe('one running run per project', () => {
  it('recognises the database refusing a second run', () => {
    expect(isDuplicateRun({ code: '23505', message: 'x' })).toBe(true);
    expect(isDuplicateRun({ message: 'duplicate key value violates unique constraint "agent_runs_one_running_per_project"' })).toBe(true);
    expect(isDuplicateRun(new Error('network'))).toBe(false);
  });

  it('a run another tab is beating for is driven elsewhere; a stale or own one is not', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const fresh = new Date(now - 5_000).toISOString();
    const stale = new Date(now - LEASE_STALE_MS - 1).toISOString();
    expect(drivenElsewhere({ status: 'running', heartbeat_at: fresh, lease_holder: 'other' }, 'me', now)).toBe(true);
    expect(drivenElsewhere({ status: 'running', heartbeat_at: fresh, lease_holder: 'me' }, 'me', now)).toBe(false);
    expect(drivenElsewhere({ status: 'running', heartbeat_at: stale, lease_holder: 'other' }, 'me', now)).toBe(false);
    expect(drivenElsewhere({ status: 'blocked', heartbeat_at: fresh, lease_holder: 'other' }, 'me', now)).toBe(false);
  });
});

describe('the ID question under "handle them for me"', () => {
  const outcome = {
    params: { conflict_question: true, routine_answer: idChangeDefault(20) },
    stop: { status: 'awaiting_decision' as const, reason: 'The revision of Final research report would give O1 to a different item…' },
  };
  const step = (over: Partial<AgentStep>): AgentStep => ({ id: 's', stage_id: 'report', action_key: 'x', params: {}, output: '', status: 'succeeded', idx: 0, ...over } as AgentStep);

  it('is answered with its own record-keeping rule, once per stage', () => {
    const taken = routineConflictAnswer({ outcome, policy: 'autonomous', routine: 'handle', stageId: 'report', steps: [] });
    expect(taken).toMatch(/Keep every item ID as v20 has it/);
    const again = routineConflictAnswer({
      outcome, policy: 'autonomous', routine: 'handle', stageId: 'report',
      steps: [step({ action_key: ROUTINE_DEFAULT_STEP, params: { conflict_answer: taken } })],
    });
    expect(again).toBeNull();
  });

  it('is asked when routine decisions are not handed over', () => {
    expect(routineConflictAnswer({ outcome, policy: 'autonomous', routine: 'ask', stageId: 'report', steps: [] })).toBeNull();
    expect(routineConflictAnswer({ outcome, policy: 'checkpoint', routine: 'handle', stageId: 'report', steps: [] })).toBeNull();
  });
});

describe('"Do whatever is best"', () => {
  it('decides nothing of record, so it is not saved as a fact', () => {
    expect(answerAsFact('Should those items come back?', DELEGATED_ANSWER, { run_id: 'r', stage_id: 's' })).toBeNull();
    expect(answerAsFact('Should those items come back?', 'Do whatever is best', { run_id: 'r', stage_id: 's' })).toBeNull();
    expect(answerAsFact('Which date?', 'Wednesday 10 December', { run_id: 'r', stage_id: 's' })).not.toBeNull();
  });
});
