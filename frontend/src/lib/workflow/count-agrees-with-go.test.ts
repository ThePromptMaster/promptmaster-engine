import { describe, expect, it } from 'vitest';

import { approvalsOnEarlierVersion } from './approvals';
import { blocksCompletion, describeOutstanding, outstandingWork, progressCaptionText, progressSummary, reapprovalByStage } from './engine';
import { objectiveNotRechecked, objectiveUnmet } from './objective';
import type { WorkflowEvent, WorkflowState, WorkflowTemplate } from './types';

/**
 * 5 Nov. "5 done · 0 to go" while the repair log said the approval was for an
 * earlier version, and "6 done · 0 to go" while Go said the review was
 * incomplete: the count said only which stages were closed.
 */
const stage = {
  id: 'pack', label: 'Final pack', short_label: 'Pack',
  exit_criteria: [
    { id: 'pack.mine', label: 'I approve this pack', check: 'manual' },
    { id: 'pack.routine', label: 'Routine sign-off', check: 'manual', authority: 'delegable' },
  ],
} as never;
const template = { stages: [stage] } as Pick<WorkflowTemplate, 'stages'>;
const v = (n: number, content: string) => ({ id: `v${n}`, version_number: n, content });
const bundles = (versions: ReturnType<typeof v>[]) => ({ pack: { artifact: null, versions } }) as never;

describe('an approval given on an earlier text than the stage holds now', () => {
  const ticked = { manual_checks: { 'pack.mine': true }, manual_check_versions: { 'pack.mine': 'v3' } };

  it('is named, with the two versions', () => {
    expect(approvalsOnEarlierVersion(ticked, template, bundles([v(3, 'old'), v(9, 'new')]))).toEqual([
      { stageId: 'pack', label: 'Pack', approval: 'I approve this pack', version: 3, current: 9 },
    ]);
  });

  it('on the current version is nothing to say', () => {
    expect(approvalsOnEarlierVersion(ticked, template, bundles([v(1, 'older'), v(3, 'same')]))).toEqual([]);
  });

  it('a newer version with the same text, a long-form snapshot, is no false alarm', () => {
    expect(approvalsOnEarlierVersion(ticked, template, bundles([v(3, 'same'), v(4, 'same')]))).toEqual([]);
  });

  it('a tick with no version on record is not guessed at', () => {
    expect(approvalsOnEarlierVersion({ manual_checks: { 'pack.mine': true } }, template, bundles([v(3, 'a'), v(4, 'b')]))).toEqual([]);
  });

  it("under \"handle them for me\" a delegable approval is Go's, and the user's own still counts", () => {
    const both = {
      manual_checks: { 'pack.mine': true, 'pack.routine': true },
      manual_check_versions: { 'pack.mine': 'v3', 'pack.routine': 'v3' },
      routine_decisions: 'handle' as const,
    };
    expect(approvalsOnEarlierVersion(both, template, bundles([v(3, 'a'), v(4, 'b')])).map((a) => a.approval)).toEqual(['I approve this pack']);
  });
});

describe('a check overtaken by a change', () => {
  const judged = { type: 'objective_assessed', created_at: '2026-11-05T23:00:00Z', payload: { outcome: 'not_met', reason: 'No.' } } as unknown as WorkflowEvent;
  const later = { type: 'brief_changed', created_at: '2026-11-05T23:01:00Z' } as unknown as WorkflowEvent;

  it('not met with nothing changed since is "not met", not "not rechecked"', () => {
    expect(objectiveUnmet([judged])).not.toBeNull();
    expect(objectiveNotRechecked([judged])).toBe(false);
  });

  it('not met with a change since is "not rechecked", where it used to say nothing', () => {
    expect(objectiveUnmet([judged, later])).toBeNull();
    expect(objectiveNotRechecked([judged, later])).toBe(true);
    expect(objectiveNotRechecked([judged], [{ created_at: '2026-11-05T23:02:00Z' }])).toBe(true);
  });

  it('a met verdict later edited, and a project never checked, ask for nothing', () => {
    const met = { ...judged, payload: { outcome: 'met', reason: 'Yes.' } } as unknown as WorkflowEvent;
    expect(objectiveNotRechecked([met, later])).toBe(false);
    expect(objectiveNotRechecked([later])).toBe(false);
  });
});

describe('the caption', () => {
  const progress = { complete: 6, skipped: 0, leftOpen: 0, remaining: 0, total: 6 };
  const state = { current_stage_id: 'pack', stages: {} } as unknown as WorkflowState;
  const work = (extras: Parameters<typeof outstandingWork>[3]) => outstandingWork({ stages: [] } as unknown as WorkflowTemplate, state, {}, extras);
  const earlier = { stageId: 'pack', label: 'Pack', approval: 'I approve this pack', version: 3, current: 9 };

  it('with nothing more to say, reads as before', () => {
    expect(progressCaptionText(progress, false, work({}))).toBe('6 done · 0 to go');
  });

  it('says the objective has not been rechecked', () => {
    expect(progressCaptionText(progress, false, work({ objectiveNotRechecked: true }))).toBe('6 done · 0 to go · objective not rechecked');
  });

  it('says how many approvals to re-confirm', () => {
    expect(progressCaptionText(progress, false, work({ approvalsOnEarlier: [earlier] }))).toBe('6 done · 0 to go · 1 approval to re-confirm');
    expect(progressCaptionText(progress, false, work({ approvalsOnEarlier: [earlier, { ...earlier, approval: 'Another' }] }))).toBe('6 done · 0 to go · 2 approvals to re-confirm');
  });

  it('a stale approval is listed but holds nothing up; a check overtaken by a change does', () => {
    const [approval] = work({ approvalsOnEarlier: [earlier] });
    expect(blocksCompletion(approval)).toBe(false);
    expect(describeOutstanding(approval)).toBe('Pack: your approval “I approve this pack” was given on v3; the current version is v9');
    const [check] = work({ objectiveNotRechecked: true });
    expect(blocksCompletion(check)).toBe(true);
  });
});

describe('a done stage to re-approve is not counted done (L-273, 21 Nov, Sean, warehouse)', () => {
  // His five stages, all marked complete again after the quote change, two approvals on earlier versions.
  const T = { stages: ['objective', 'draft', 'check', 'approve_option', 'final_memo'].map((id) => ({ id, label: id, exit_criteria: [] })) } as unknown as WorkflowTemplate;
  const done = { current_stage_id: 'final_memo', stages: Object.fromEntries(T.stages.map((s) => [s.id, { status: 'complete' }])) } as unknown as WorkflowState;
  const items = outstandingWork(T, done, {}, {
    approvalsOnEarlier: [
      { stageId: 'approve_option', label: 'Approve option', approval: 'I choose the labeling option to approve.', version: 1, current: 3 },
      { stageId: 'final_memo', label: 'Final memo', approval: 'I approve the finished memo as it stands.', version: 1, current: 4 },
    ],
  });

  it('reads "3 done · 2 to re-approve · 0 to go", not "5 done · 0 to go"', () => {
    const reapprove = reapprovalByStage(items);
    expect(Object.keys(reapprove)).toEqual(['approve_option', 'final_memo']);
    const progress = progressSummary(T, done, reapprove);
    expect(progress).toMatchObject({ complete: 3, reapprove: 2, remaining: 0 });
    expect(progressCaptionText(progress, false, items)).toBe('3 done · 2 to re-approve · 0 to go');
  });

  it('an approval on a stage not done is still listed as an approval', () => {
    const open = { ...done, stages: { ...done.stages, final_memo: { status: 'in_progress' } } } as unknown as WorkflowState;
    const progress = progressSummary(T, open, reapprovalByStage(items));
    expect(progressCaptionText(progress, false, items)).toBe('3 done · 1 to re-approve · 1 to go · 1 approval to re-confirm');
  });
});
