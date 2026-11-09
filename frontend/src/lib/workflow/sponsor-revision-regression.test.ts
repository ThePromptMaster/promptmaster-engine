/**
 * The failure this guards against, end to end on pure functions. A seven-stage
 * rollout package took one sponsor revision on 7 Nov. Each repair was refused
 * on a correct $8,000 training cost, the chapter plan could not be repaired, and
 * the documents were rewritten against the old plan. The same happened on the
 * production test of the fix on 9 Nov in a different table layout, so both
 * layouts are here as they were saved.
 */
import { describe, expect, it } from 'vitest';

import { exhaustedRepair, staleRepair, unrepairableStale, unsettledRepairs } from '@/lib/agent/needs';
import type { ProjectFact } from '@/types/project';

import { arithmeticSlips } from './arithmetic';
import { outstandingWork, projectState } from './engine';
import { leftoverMentions, leftoverValues } from './fact-values';
import { supersededFactValues } from './facts';
import { deliverableReadiness, overallStatus } from './readiness';
import type { WorkflowEvent, WorkflowTemplate } from './types';
import { strayWorkingText } from './working-text';

const STAGES = [
  ['objective', 'prose'],
  ['requirements', 'list'],
  ['core_plan', 'prose'],
  ['chapter_plan', 'outline'],
  ['documents', 'long_form'],
  ['check', 'review'],
  ['package', 'prose'],
] as const;

const template = {
  key: 'custom_rollout',
  stages: STAGES.map(([id, renderer]) => ({ id, label: id, short_label: id, renderer, group: 'drafting', required: true, exit_criteria: [], transitions: { allow_skip: false } })),
} as unknown as WorkflowTemplate;

const ev = (type: string, stage_id: string, minute: number, payload: Record<string, unknown> = {}): WorkflowEvent =>
  ({ type, stage_id, actor: 'user', created_at: `2026-11-07T22:${String(minute).padStart(2, '0')}:00Z`, payload }) as unknown as WorkflowEvent;

const finished = STAGES.map(([id], i) => ev('stage_marked_complete', id, i, { evidence_version_id: `v-${id}` }));
const revision = ev('brief_changed', 'package', 30, { kind: 'fact', affected: STAGES.map(([stage_id]) => ({ stage_id, reason: 'The sponsor changed the budget, migration price and session size.' })) });
const reopened = projectState(template, [...finished, revision]);

const fact = (id: string, statement: string, supersedes: string | null, retired: string | null = null) =>
  ({ id, project_id: 'p', user_id: 'u', statement, subject: null, kind: 'fact', source_kind: 'user_edit', source_ref: {}, accepted_by: 'user', agent_run_id: null, supersedes, retired_at: retired, retired_reason: null, created_at: '2026-11-07T23:24:00Z' }) as ProjectFact;

describe('one sponsor revision reaches every stage', () => {
  it('reopens all seven, the chapter plan included', () => {
    expect(STAGES.map(([id]) => reopened.stages[id].status)).toEqual(STAGES.map(() => 'stale'));
  });

  it('repairs from the first stage, and the chapter plan is Go’s under "handle them for me"', () => {
    expect(staleRepair(template, reopened, [], {}, new Set(), null, {}, true)?.params).toMatchObject({ stage_id: 'objective' });
    const onlyPlanLeft = { ...reopened, stages: { ...reopened.stages, objective: { status: 'complete' }, requirements: { status: 'complete' }, core_plan: { status: 'complete' } } } as typeof reopened;
    expect(staleRepair(template, onlyPlanLeft, [], {}, new Set(), null, {}, true)?.params).toMatchObject({ stage_id: 'chapter_plan' });
    expect(unrepairableStale(template, onlyPlanLeft, true)).toBeNull();
  });

  it('stops at the first stage it cannot settle, not at the documents built on it', () => {
    const tried = ['core_plan', 'core_plan'];
    expect(staleRepair(template, { ...reopened, stages: { ...reopened.stages, objective: { status: 'complete' }, requirements: { status: 'complete' } } } as typeof reopened, tried, {}, new Set(), null, {}, true)).toBeNull();
    expect(exhaustedRepair(template, reopened, tried)).toBe('core_plan');
  });
});

describe('the correct training cost passes and the old migration price does not', () => {
  const asLabel = supersededFactValues([fact('old', 'Data migration: $8,000 fixed.', null, 't'), fact('new', 'Data migration: $13,000 fixed.', 'old')]);
  const asListItem = supersededFactValues([
    fact('old', 'Fixed prices: process mapping $6,000; configuration $18,000; migration $8,000; launch support $6,000.', null, 't'),
    fact('new', 'Fixed prices: process mapping $6,000; configuration $18,000; migration $13,000; launch support $6,000.', 'old'),
  ]);
  const savedFirst = ['| Training, 8 sessions × $1,000 | 8 × $1,000 = **$8,000** | Conditional booking after G2 |', '| **Committed** | $43,000 + $8,000 = **$51,000** | |'].join('\n');
  const savedSecond = ['| Training, eight sessions | $8,000 | 8 × $1,000 |', '| **Planned total** | **$51,000** | $43,000 + $8,000 |'].join('\n');

  it('passes both layouts the plan was saved in', () => {
    expect(leftoverMentions(savedFirst, asLabel)).toEqual([]);
    expect(leftoverMentions(savedSecond, asListItem)).toEqual([]);
  });

  it('catches the old price where it applies', () => {
    expect(leftoverValues(`${savedSecond}\n| Migration | $8,000 | Fixed |`, asListItem)).toHaveLength(1);
    expect(leftoverValues(`${savedFirst}\nData migration: $8,000`, asLabel)).toHaveLength(1);
  });

  it('the saved sums are recomputed, and a wrong one is named', () => {
    expect(arithmeticSlips(savedFirst)).toEqual([]);
    expect(arithmeticSlips('| **Committed** | $43,000 + $8,000 = **$52,000** | |')).toHaveLength(1);
  });

  it('the working left in one version of the package is refused', () => {
    expect(strayWorkingText('Total = **$45,000**? see below\nCorrection to the total line above: $51,000.').length).toBeGreaterThan(0);
  });
});

describe('the status does not overstate it', () => {
  const outstanding = outstandingWork(template, reopened, {});

  it('every stage done is not complete while one is reopened', () => {
    expect(overallStatus({ outstanding, finalized: false, repairFailed: false, waitingOnUser: false, openActions: 0, allStagesDone: true })).toBe('stale_dependency');
  });

  it('a failed repair comes first, and the reopened stage says what the tries came to', () => {
    expect(overallStatus({ outstanding, finalized: false, repairFailed: true, waitingOnUser: true, openActions: 0, allStagesDone: false })).toBe('repair_failed');
    const steps = [{ action_key: 'recheck_stage', status: 'failed', stage_id: 'package', params: { stage_id: 'core_plan' }, output: 'Couldn’t finish repairing.' }] as never[];
    expect(unsettledRepairs(reopened, steps)).toEqual({ core_plan: { tries: 1, last: 'Couldn’t finish repairing.' } });
  });

  it('an approval given on an earlier version does not make the deliverable ready', () => {
    const rows = deliverableReadiness({
      versions: [{ id: 'v6', version_number: 6 }, { id: 'v7', version_number: 7 }],
      assessment: { outcome: 'met', versionId: 'v7' },
      evaluatedVersionIds: new Set(),
      approvals: [{ id: 'a', satisfied: true }],
      approvalVersions: { a: 'v6' },
      blocking: [],
    });
    expect(rows.find((r) => r.key === 'approved')).toMatchObject({ state: 'open', earlier: 6, version: 7 });
    expect(rows.find((r) => r.key === 'ready')?.state).toBe('open');
  });
});
