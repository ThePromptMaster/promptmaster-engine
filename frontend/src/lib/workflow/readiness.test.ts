import { describe, expect, it } from 'vitest';

import type { OutstandingItem } from './engine';
import { deliverableReadiness, overallStatus, readinessBlocking } from './readiness';

const stale = { kind: 'stale_stage', stageId: 'plan', label: 'Plan', reason: 'x' } as OutstandingItem;
const base = { outstanding: [], finalized: false, repairFailed: false, waitingOnUser: false, openActions: 0, allStagesDone: false };

describe('one status for the project (8 Nov)', () => {
  it('a failed repair comes first, then stale work, then a decision', () => {
    expect(overallStatus({ ...base, repairFailed: true, outstanding: [stale], waitingOnUser: true })).toBe('repair_failed');
    expect(overallStatus({ ...base, outstanding: [stale], waitingOnUser: true })).toBe('stale_dependency');
    expect(overallStatus({ ...base, waitingOnUser: true })).toBe('needs_decision');
    expect(overallStatus(base)).toBe('in_progress');
  });

  it('every stage done is not complete while earlier work is stale', () => {
    expect(overallStatus({ ...base, allStagesDone: true, outstanding: [stale] })).toBe('stale_dependency');
    expect(overallStatus({ ...base, allStagesDone: true })).toBe('complete');
  });

  it('a finished document with real-world actions open says so', () => {
    expect(overallStatus({ ...base, finalized: true, openActions: 3 })).toBe('finished_actions_open');
    expect(overallStatus({ ...base, finalized: true })).toBe('complete');
  });
});

describe('the deliverable’s four states, each with its version', () => {
  const versions = [{ id: 'a', version_number: 6 }, { id: 'b', version_number: 7 }];
  const input = { versions, evaluatedVersionIds: new Set<string>(), approvals: [{ id: 'x', satisfied: true }], approvalVersions: { x: 'b' }, blocking: [] as string[] };

  it('all current', () => {
    const rows = deliverableReadiness({ ...input, assessment: { outcome: 'met', versionId: 'b' } });
    expect(rows.map((r) => [r.key, r.state, r.version])).toEqual([['written', 'done', 7], ['checked', 'done', 7], ['approved', 'done', 7], ['ready', 'done', 7]]);
  });

  it('an approval or check on an earlier version says which, and approval blocks ready', () => {
    const rows = deliverableReadiness({ ...input, approvalVersions: { x: 'a' }, assessment: { outcome: 'met', versionId: 'a' } });
    expect(rows[1]).toMatchObject({ key: 'checked', state: 'open', earlier: 6, version: 7 });
    expect(rows[2]).toMatchObject({ key: 'approved', state: 'open', earlier: 6, version: 7 });
    expect(rows[3].state).toBe('open');
  });

  it('what still blocks is named on Ready', () => {
    const rows = deliverableReadiness({ ...input, assessment: null, blocking: ['Plan needs a recheck'] });
    expect(rows[3]).toMatchObject({ key: 'ready', state: 'open', detail: 'Plan needs a recheck' });
  });

  it('no approval asked for is said as that, and does not block', () => {
    const rows = deliverableReadiness({ ...input, approvals: [], assessment: { outcome: 'met', versionId: 'b' } });
    expect(rows[2].state).toBe('none');
    expect(rows[3].state).toBe('done');
  });
});

describe('a version its own check faults is not ready (28 Nov, Sean, Harborlight; L-326)', () => {
  const versions = [{ id: 'v3', version_number: 3 }];
  const says = { stageId: 'answer', label: 'Answer', says: 'it computes 48 seats; 18 × 2 = 36, a shortfall of 4' };

  it('the check on the head holds Ready, first, though it holds no finish', () => {
    const blocking = readinessBlocking([], says);
    expect(blocking).toEqual([{ kind: 'check_says', ...says }]);
    const rows = deliverableReadiness({ versions, evaluatedVersionIds: new Set(['v3']), approvals: [], approvalVersions: {}, blocking: blocking.map((b) => (b.kind === 'check_says' ? b.says : '')) });
    expect(rows[1]).toMatchObject({ key: 'checked', state: 'done', version: 3 });
    expect(rows[3]).toMatchObject({ key: 'ready', state: 'open', detail: says.says });
  });

  it('with no verdict, only what holds finishing counts', () => {
    expect(readinessBlocking([stale], null)).toEqual([stale]);
    const optional = { kind: 'approval_on_earlier_version', stageId: 'x', label: 'X', version: 1, current: 2 } as unknown as OutstandingItem;
    expect(readinessBlocking([optional], null)).toEqual([]);
  });
});

describe('a fix saved after a failed check waits for its own check (L-326)', () => {
  const versions = [{ id: 'v3', version_number: 3 }, { id: 'v4', version_number: 4 }];
  const input = { versions, evaluatedVersionIds: new Set(['v3']), approvals: [], approvalVersions: {}, blocking: [] as string[] };

  it('the check of v3 found problems and v4 is not checked: not ready, and says why', () => {
    const rows = deliverableReadiness({ ...input, faultedEarlier: 3 });
    expect(rows[1]).toMatchObject({ key: 'checked', state: 'open', earlier: 3, version: 4 });
    expect(rows[3]).toMatchObject({ key: 'ready', state: 'open', recheck: true, earlier: 3, version: 4 });
  });

  it('once v4 is checked, or when the earlier check passed, it is ready', () => {
    expect(deliverableReadiness({ ...input, evaluatedVersionIds: new Set(['v3', 'v4']), faultedEarlier: 3 })[3]).toMatchObject({ state: 'done', version: 4 });
    expect(deliverableReadiness(input)[3]).toMatchObject({ state: 'done', version: 4 });
  });

  it('what holds finishing is said first', () => {
    expect(deliverableReadiness({ ...input, faultedEarlier: 3, blocking: ['Answer needs a recheck'] })[3]).toEqual({ key: 'ready', state: 'open', detail: 'Answer needs a recheck' });
  });
});
