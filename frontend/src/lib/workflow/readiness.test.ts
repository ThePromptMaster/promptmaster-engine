import { describe, expect, it } from 'vitest';

import type { OutstandingItem } from './engine';
import { deliverableReadiness, overallStatus } from './readiness';

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
