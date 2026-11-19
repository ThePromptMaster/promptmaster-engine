import { describe, expect, it } from 'vitest';

import { isDelegatedAnswer } from './answers';
import { approvalsLeftToGo, approvalsToRead, approvalTheQuestionIsAbout, mayBeLeftToGo, withApprovalsLeftToGo } from './left-to-go-approvals';
import { evaluateStage } from './engine';
import type { WorkflowTemplate } from './types';

/**
 * 19 Nov (Sean, Equipment Replacement): "The original instruction delegated routine
 * recommendations and reserved actual purchase authorization." The run stopped for
 * "I choose the vendor to recommend" as "yours alone", and again after he answered
 * "You choose, and state the deciding factor clearly."
 */

const stage = (id: string, criteria: { id: string; label: string; authority?: 'delegable' | 'reserved' }[]) => ({
  id, label: id[0].toUpperCase() + id.slice(1), renderer: 'prose', transitions: {},
  exit_criteria: criteria.map((c) => ({ ...c, check: 'manual' as const, blocking: true })),
});

const TEMPLATE = {
  id: 't', key: 'custom_x', version: 1,
  stages: [
    stage('costs', [{ id: 'costs.approved', label: 'I authorize the purchase from the chosen vendor', authority: 'reserved' }]),
    stage('recommendation', [
      { id: 'recommendation.approved', label: 'I choose the vendor to recommend', authority: 'reserved' },
      { id: 'recommendation.decision', label: 'I accept any new commitments it proposes', authority: 'reserved' },
    ]),
    stage('package', [{ id: 'package.approved', label: 'I approve the final package', authority: 'reserved' }]),
  ],
} as unknown as WorkflowTemplate;

const grant = (id: string, over: Record<string, unknown> = {}) => ({ type: 'approval_left_to_go' as const, payload: { criterion_id: id, quote: 'Keep warranty verification and actual purchase authorization pending.', source: 'brief', ...over } });

describe('reserved approvals the user left to Go', () => {
  it('never the last stage, a commitments sign-off, or an authorisation', () => {
    const [costs, rec, pkg] = TEMPLATE.stages;
    expect(mayBeLeftToGo(TEMPLATE, rec, rec.exit_criteria[0])).toBe(true);
    expect(mayBeLeftToGo(TEMPLATE, rec, rec.exit_criteria[1])).toBe(false);
    expect(mayBeLeftToGo(TEMPLATE, pkg, pkg.exit_criteria[0])).toBe(false);
    expect(mayBeLeftToGo(TEMPLATE, costs, costs.exit_criteria[0])).toBe(false);
    expect(approvalsToRead(TEMPLATE, [], {}).map((a) => a.id)).toEqual(['recommendation.approved']);
  });

  it('a hand-over makes it routine, with the words that made it, until the user takes it back', () => {
    const left = withApprovalsLeftToGo(TEMPLATE, [grant('recommendation.approved'), grant('package.approved'), grant('costs.approved')]);
    const rec = left.stages[1].exit_criteria[0];
    expect(rec.authority).toBe('delegable');
    expect(rec.leftToGo?.quote).toContain('purchase authorization pending');
    // The last stage and the authorisation stay the user's, whatever an event says.
    expect(left.stages[2].exit_criteria[0].authority).toBe('reserved');
    expect(left.stages[0].exit_criteria[0].authority).toBe('reserved');
    const result = evaluateStage(left, 'recommendation', { fields: {}, itemCounts: {}, itemsMissingStatus: {}, artifactNonEmpty: {}, outlineApproved: false, sections: {}, findings: {}, manualChecks: {} } as never);
    expect(result.criteria[0].leftToGo?.source).toBe('brief');
    const back = [grant('recommendation.approved'), { type: 'approval_left_to_go' as const, payload: { criterion_id: 'recommendation.approved', quote: '', source: 'answer', undone: true } }];
    expect(approvalsLeftToGo(back).size).toBe(0);
    expect(withApprovalsLeftToGo(TEMPLATE, back)).toBe(TEMPLATE);
    // Taken back, the brief is not read for it again.
    expect(approvalsToRead(TEMPLATE, back, {})).toEqual([]);
  });

  it('"You choose" leaves it to Go, and the question names the approval it is about', () => {
    expect(isDelegatedAnswer('You choose, and state the deciding factor clearly.')).toBe(true);
    expect(isDelegatedAnswer('Your call.')).toBe(true);
    expect(isDelegatedAnswer('Do whatever is best')).toBe(true);
    expect(isDelegatedAnswer('Vendor A: $69,000 over three years')).toBe(false);
    const rec = TEMPLATE.stages[1];
    expect(approvalTheQuestionIsAbout(TEMPLATE, rec, 'Which vendor should the recommendation name, Vendor A or Vendor B?', {})?.id).toBe('recommendation.approved');
    expect(approvalTheQuestionIsAbout(TEMPLATE, rec, 'Should the table show monthly totals?', {})).toBeNull();
    expect(approvalTheQuestionIsAbout(TEMPLATE, rec, 'Which vendor should the recommendation name?', { 'recommendation.approved': true })).toBeNull();
  });
});
