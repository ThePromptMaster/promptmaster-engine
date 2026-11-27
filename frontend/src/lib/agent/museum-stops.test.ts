import { describe, expect, it } from 'vitest';

import { approvalOnHead } from './facts';
import { expandRanges, namedRows } from './left-to-go';
import { allowedActions } from './policy';
import { requiredWork } from './needs';
import { findingRisk, onlyRecordKeeping } from '@/lib/workflow/triage';
import type { StageDefinition, WorkflowState, WorkflowTemplate } from '@/lib/workflow/types';

/**
 * Sean, 27 Nov, museum print job (L-320): under "handle them for me" Go asked him whether
 * findings i2–i4 were superseded, and after he approved v8 it checked v8, applied three
 * wording findings and asked him to approve v9.
 */
const I5 = {
  id: 'i5',
  finding: 'i2, i3 and i4 test text that the current records no longer contain. v2 reads "Project status: Open." Under the accepted fact that acceptance of carton B was withdrawn, the confirmations in i2–i4 are superseded.',
  why_it_matters: 'If i2–i4 are left as the check\'s result, the check certifies a closure that the closing rule now refuses.',
  suggested_change: 'Treat i2–i4 as superseded history. Take the current result from i6–i11: the status Open is correct, and the records must be fixed where these rows say.',
  severity: 'major',
  status: '',
};
const schema = { fields: [{ key: 'severity', options: ['minor', 'major', 'critical'] }], statuses: [] } as never;

describe('a finding about the check\'s own record is Go\'s under "handle them for me" (L-320)', () => {
  it("reads Sean's i5 as record-keeping, routine whatever its severity", () => {
    expect(onlyRecordKeeping(I5 as never)).toBe(true);
    expect(findingRisk(I5 as never, schema)).toBe('routine');
  });

  it('a major finding that changes the work stays the user\'s', () => {
    const work = { ...I5, id: 'i7', suggested_change: 'Rewrite the job board status line to say carton B is open, superseding i2.' };
    expect(onlyRecordKeeping(work as never)).toBe(false);
    expect(findingRisk(work as never, schema)).toBe('material');
  });

  it('"i2–i4" names i3 too', () => {
    expect(expandRanges('Accept i5: treat i2–i4 as superseded; take the result from i6-i8.')).toBe('Accept i5: treat i2, i3, i4 as superseded; take the result from i6, i7, i8.');
    const open = ['i2', 'i3', 'i4', 'i9'].map((id) => ({ id, stageId: 'check' }));
    expect(namedRows(['Treat i2–i4 as superseded history.'], open as never).map((r) => r.id)).toEqual(['i2', 'i3', 'i4']);
  });
});

describe('an approved version is not polished; a re-approval is checked first (L-320)', () => {
  const stage = {
    id: 'finalise', label: 'Finalise', renderer: 'prose',
    exit_criteria: [
      { id: 'finalise.written', label: 'Written', check: 'auto', rule: { type: 'artifact_non_empty' }, blocking: true },
      { id: 'finalise.approved', label: 'I approve the finished deliverables.', check: 'manual', blocking: true },
    ],
    transitions: {}, expected_artifacts: [{ kind: 'final', primary: true }],
  } as unknown as StageDefinition;
  const template = { key: 'custom_museum', stages: [stage] } as unknown as WorkflowTemplate;
  const state = { current_stage_id: 'finalise', stages: { finalise: { status: 'complete' } } } as WorkflowState;
  const versions = [{ id: 'v8', content: 'Job board v8' }, { id: 'v9', content: 'Job board v9' }];

  it('reads whose approval stands on which version', () => {
    const project = (on: string) => ({ manual_checks: { 'finalise.approved': true }, manual_check_versions: { 'finalise.approved': on } });
    expect(approvalOnHead(project('v9'), stage, versions)).toEqual({ approvedHead: true, reapprovalDue: false });
    expect(approvalOnHead(project('v8'), stage, versions)).toEqual({ approvedHead: false, reapprovalDue: true });
    expect(approvalOnHead({ manual_checks: {}, manual_check_versions: {} }, stage, versions)).toEqual({ approvedHead: false, reapprovalDue: false });
  });

  it('offers no check, revision or findings on a version the user approved', () => {
    const facts = { approvedHead: true, draft: { checked: false } as never, evaluationFindings: { count: 3, aboutHead: true } };
    const keys = allowedActions(template, state, stage, true, undefined, facts);
    expect(keys).not.toContain('evaluate_stage');
    expect(keys).not.toContain('revise_stage');
    expect(keys).not.toContain('apply_findings');
    expect(allowedActions(template, state, stage, true, undefined, { ...facts, approvedHead: false })).toEqual(expect.arrayContaining(['evaluate_stage', 'revise_stage', 'apply_findings']));
  });

  it('checks a version before asking for its approval again, then applies what the check found', () => {
    const evaluation = { satisfied: [], unmet: [] } as never;
    const allowed = ['evaluate_stage', 'apply_findings', 'request_user_decision'];
    const unchecked = requiredWork({ stage, facts: { reapprovalDue: true, draft: { checked: false } as never }, stageEvaluation: evaluation, allowed });
    expect(unchecked?.key).toBe('evaluate_stage');
    const found = requiredWork({ stage, facts: { reapprovalDue: true, draft: { checked: true } as never, evaluationFindings: { count: 2, aboutHead: true } }, stageEvaluation: evaluation, allowed });
    expect(found?.key).toBe('apply_findings');
    expect(requiredWork({ stage, facts: { reapprovalDue: true, draft: { checked: true } as never }, stageEvaluation: evaluation, allowed })).toBeNull();
  });
});
