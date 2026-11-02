import { describe, expect, it } from 'vitest';
import { initialState } from '@/lib/workflow/engine';
import type { StageDefinition, StageEvaluation, WorkflowTemplate } from '@/lib/workflow/types';
import { findingsAllDecided, restatesTriage } from '@/lib/workflow/triage-approval';
import { needsUser, requiredWork } from './needs';

// The shape of the tattoo test's designed Check stage (custom_e1136947be, 1 Nov).
const check: StageDefinition = {
  id: 'check_against_requirements', label: 'Check against requirements', short_label: 'Check', group: 'evaluation',
  renderer: 'review', required: true, expected_artifacts: [{ kind: 'critique_report', cardinality: 'one', primary: true }],
  exit_criteria: [
    { id: 'check_against_requirements.triaged', label: 'Every finding accepted or rejected', check: 'auto', rule: { type: 'all_findings_triaged' }, blocking: false },
    { id: 'check_against_requirements.approved', label: 'I have accepted or rejected each finding', check: 'manual', blocking: true, authority: 'delegable' },
  ],
  transitions: { default_next: null },
} as never;
const template = { key: 'custom_x', version: 1, stages: [check] } as unknown as WorkflowTemplate;

const approvalLeft: StageEvaluation = {
  stageId: check.id, canAdvance: false, criteria: [],
  unmet: [{ id: 'check_against_requirements.approved', label: 'I have accepted or rejected each finding', blocking: true, manual: true, satisfied: false, authority: 'delegable' } as never],
};
// After Go's triage: every row decided, so no routine or material rows left, and a table has no draft.
const facts = { review: { items: [], schema: {} as never, routine: [], material: [], outcome: false } } as never;
const input = {
  state: initialState(template), stage: check, facts, stageEvaluation: approvalLeft,
  allowed: ['commit_delegated', 'request_user_decision'], policy: 'autonomous' as const, outlineStageId: null,
  routine: 'handle' as const, commitTried: [] as string[],
};

describe('a table stage\'s routine approval under "Handle them for me" (2 Nov, Sean)', () => {
  it('is committed by Go, not left for the user, once the findings are decided', () => {
    expect(requiredWork(input)).toMatchObject({ key: 'commit_delegated', params: { criterion_id: 'check_against_requirements.approved' } });
    expect(needsUser(input)).toBeNull();
  });

  it('still waits for the user under "Ask me"', () => {
    const ask = { ...input, routine: 'ask' as const, allowed: ['request_user_decision'] };
    expect(requiredWork(ask)).toBeNull();
    expect(needsUser(ask)).toMatchObject({ kind: 'tick_criterion', criterionId: 'check_against_requirements.approved', authority: 'policy_ask' });
  });

  it('a reserved approval on a table is never Go\'s', () => {
    const reserved = { ...check, exit_criteria: [check.exit_criteria[0], { ...check.exit_criteria[1], authority: 'reserved' as const }] };
    const res = { ...input, stage: reserved, stageEvaluation: { ...approvalLeft, unmet: [{ ...approvalLeft.unmet[0], authority: undefined }] } as never };
    expect(requiredWork(res)).toBeNull();
    expect(needsUser(res)).toMatchObject({ kind: 'tick_criterion', authority: 'reserved' });
  });
});

describe('an approval that only restates "every finding decided"', () => {
  it('is recognised in the wordings designers produce', () => {
    expect(restatesTriage('I have accepted or rejected each finding')).toBe(true);
    expect(restatesTriage('Every finding accepted or rejected')).toBe(true);
    expect(restatesTriage('I have decided all findings')).toBe(true);
    expect(restatesTriage('I accept this recommendation as the basis for the memo')).toBe(false);
    expect(restatesTriage('I approve this memo for use')).toBe(false);
  });

  it('is read from the table: the count when every row has a decision, else null', () => {
    const row = (id: string, status?: string) => ({ id, finding: `Finding ${id}`, severity: 'minor', ...(status ? { status, reason: 'Checked.', status_source: 'model' } : {}) });
    const table = (items: object[]) => JSON.stringify({ kind: 'stage_items', items });
    expect(findingsAllDecided(check, table([row('i1', 'accepted'), row('i2', 'rejected')]))).toBe(2);
    expect(findingsAllDecided(check, table([row('i1', 'accepted'), row('i2')]))).toBeNull();
    expect(findingsAllDecided(check, table([]))).toBeNull();
  });
});
