import { describe, expect, it } from 'vitest';

import { approvalsGiven, approvalsOnEarlierVersion, approvalStandsThroughRepairs } from './approvals';
import type { WorkflowTemplate } from './types';

const stage = { id: 'final', label: 'Final', exit_criteria: [{ id: 'ok', label: 'I approve this.', check: 'manual', authority: 'reserved' }] } as unknown as WorkflowTemplate['stages'][number];
const v = (n: number, source_operation: string, change_summary = '') => ({ id: `v${n}`, version_number: n, source_operation, content: `text ${n}`, change_summary });
const project = { manual_checks: { ok: true }, manual_check_versions: { ok: 'v9' } };

describe('an approval and the routine repairs after it (8 Nov)', () => {
  it('stands through Go\'s routine repairs', () => {
    expect(approvalStandsThroughRepairs(project, stage, [v(9, 'agent_draft'), v(10, 'agent_revise'), v(11, 'agent_apply')])).toBe(true);
  });
  it('does not, once the user changed the text', () => {
    expect(approvalStandsThroughRepairs(project, stage, [v(9, 'agent_draft'), v(10, 'chat_instruct'), v(11, 'agent_revise')])).toBe(false);
  });
  it('does not when it is on the current version, or was never given', () => {
    expect(approvalStandsThroughRepairs(project, stage, [v(9, 'agent_draft')])).toBe(false);
    expect(approvalStandsThroughRepairs({ manual_checks: {}, manual_check_versions: {} }, stage, [v(9, 'agent_draft'), v(10, 'agent_revise')])).toBe(false);
  });
  it('says what changed since, against the version it was given on', () => {
    const out = approvalsOnEarlierVersion(project as never, { stages: [stage] }, { final: { artifact: null, versions: [v(9, 'agent_draft'), v(10, 'agent_revise', 'Shortened to fit the target.\nMore.')] } } as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ version: 9, current: 10, since: ['Shortened to fit the target.'] });
  });
});

describe('an approval Go gave under the routine policy is marked as Go\'s (16 Nov, hand pass)', () => {
  const template = { stages: [stage] } as unknown as WorkflowTemplate;
  const bundles = { final: { artifact: null, versions: [v(9, 'agent_draft'), v(10, 'agent_revise')] } } as never;
  const committed = (version: string, reconfirmed = false) => ({
    type: 'criterion_committed', payload: { criterion_id: 'ok', policy: 'routine_decisions', evidence_version_id: version, ...(reconfirmed ? { reconfirmed: true } : {}) },
  });

  it('Go committed it on the version it stands on', () => {
    const [a] = approvalsGiven({ manual_checks: { ok: true }, manual_check_versions: { ok: 'v9' }, facts: [] }, template, bundles, [committed('v9')] as never);
    expect(a).toMatchObject({ approval: 'I approve this.', by_policy: true });
  });

  it("the user's own tick is not, and neither is the user's approval Go only re-confirmed", () => {
    const [mine] = approvalsGiven({ manual_checks: { ok: true }, manual_check_versions: { ok: 'v9' }, facts: [] }, template, bundles, []);
    expect(mine.by_policy).toBeUndefined();
    const [kept] = approvalsGiven({ manual_checks: { ok: true }, manual_check_versions: { ok: 'v10' }, facts: [] }, template, bundles, [committed('v10', true)] as never);
    expect(kept.by_policy).toBeUndefined();
    // Go committed it on v9; the user ticked it again on v10 themselves.
    const [retick] = approvalsGiven({ manual_checks: { ok: true }, manual_check_versions: { ok: 'v10' }, facts: [] }, template, bundles, [committed('v9')] as never);
    expect(retick.by_policy).toBeUndefined();
  });
});
