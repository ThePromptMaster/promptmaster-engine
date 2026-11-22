import { describe, expect, it } from 'vitest';

import type { ProjectFact } from '@/types/project';
import { decisionsSetAside, setAsideReason } from './approvals';
import { factsText } from './facts';
import { statementsOf } from './fact-dependencies';

const fact = (id: string, statement: string, ref: Record<string, unknown> = {}, extra: Partial<ProjectFact> = {}): ProjectFact =>
  ({ id, statement, subject: null, kind: 'fact', source_kind: 'user_edit', source_ref: ref, retired_at: null, supersedes: null, created_at: '2026-11-22T00:36:20Z', ...extra }) as unknown as ProjectFact;

describe('a decision whose option a fact change concerns is set aside (L-272, 21 Nov, Sean)', () => {
  // Scanner: Option B approved at $60,000, then Option B's training rose to $7,500.
  const bOld = 'Option B: two vendors; $49,000 equipment and installation + $6,000 training; all three sites live by December 18';
  const aOld = 'Option A: one vendor; $47,000 equipment and installation + $6,000 training; two sites live by December 16, third site live December 21';
  const decision = fact('d', 'Decided by the user — on "I choose the option to approve" (Approver decision): I approve Option B at $60,000 all-in for all three sites to go live by December 18.', {
    via: 'go answer', criterion_id: 'approver_decision_on_an_option.approved', stage_id: 'approver_decision_on_an_option',
    choice: 'I approve Option B at $60,000 all-in for all three sites to go live by December 18.',
  }, { subject: 'Decision' });
  const ticked = { 'approver_decision_on_an_option.approved': true };

  it('Option B\'s changed fact sets aside the Option B decision', () => {
    const out = decisionsSetAside({ facts: [decision], manual_checks: ticked }, [bOld]);
    expect(out).toEqual([{ criterionId: 'approver_decision_on_an_option.approved', stageId: 'approver_decision_on_an_option', choice: decision.source_ref!.choice, because: bOld }]);
    expect(setAsideReason(out[0])).toContain('set aside until the user decides again');
  });

  it('a change to another option sets nothing aside', () => {
    expect(decisionsSetAside({ facts: [decision], manual_checks: ticked }, [aOld])).toEqual([]);
  });

  it('a fact about every option sets it aside', () => {
    expect(decisionsSetAside({ facts: [decision], manual_checks: ticked }, ['Each option includes a $6,000 training charge.'])).toHaveLength(1);
  });

  it('deciding again (the old decision line removed) sets nothing aside', () => {
    const removed = statementsOf(factsText([decision]));
    expect(removed[0]).toMatch(/^Decision: Decided by the user/);
    expect(decisionsSetAside({ facts: [decision], manual_checks: ticked }, removed)).toEqual([]);
  });

  it('an approval already taken back, or a retired decision, is not set aside again', () => {
    expect(decisionsSetAside({ facts: [decision], manual_checks: {} }, [bOld])).toEqual([]);
    expect(decisionsSetAside({ facts: [{ ...decision, retired_at: '2026-11-22T01:00:00Z' }], manual_checks: ticked }, [bOld])).toEqual([]);
  });

  it('warehouse: Option A chosen at $48,000, then Option A\'s training rose from $7,000 to $11,000', () => {
    const chose = fact('w', 'Decided by the user — on "I choose the labeling option to approve" (Approve option): Option A: $48,000 all-in, all sites live December 17', {
      criterion_id: 'approve_an_option.approved', stage_id: 'approve_an_option', choice: 'Option A: $48,000 all-in, all sites live December 17',
    });
    const removed = ['Option A: $36,000 equipment and installation, plus $7,000 training; all sites go live December 17 after completing the required pilots.'];
    expect(decisionsSetAside({ facts: [chose], manual_checks: { 'approve_an_option.approved': true } }, removed).map((d) => d.stageId)).toEqual(['approve_an_option']);
  });
});

describe('the reopened decision stage is answered by its next version (L-272, 22 Nov, production pass)', () => {
  it('a decision stage reopened by a set-aside goes back to in progress when its repair is saved; another done stage stays stale', async () => {
    const { projectState } = await import('./engine');
    const T = { key: 't', stages: ['draft', 'decision', 'final'].map((id) => ({ id, label: id, exit_criteria: [], transitions: {} })) } as never;
    const at = (n: number) => `2026-11-22T19:0${n}:00Z`;
    const ev = (seq: number, type: string, stage_id: string, payload: Record<string, unknown> = {}) => ({ seq, type, stage_id, payload, created_at: at(seq), actor: 'system' });
    const events = [
      ev(1, 'stage_marked_complete', 'draft'), ev(2, 'stage_marked_complete', 'decision'), ev(3, 'stage_marked_complete', 'final'),
      ev(4, 'brief_changed', 'final', {
        kind: 'fact', affected: [{ stage_id: 'decision', reason: 'set aside' }, { stage_id: 'final', reason: 'changed' }],
        decisions_set_aside: [{ stageId: 'decision', criterionId: 'decision.approved', choice: 'Option A', because: 'Option A: …' }],
      }),
      ev(5, 'stage_version_saved', 'decision', { version_number: 4 }),
      ev(6, 'stage_version_saved', 'final', { version_number: 5 }),
    ];
    const state = projectState(T, events as never);
    expect(state.stages.decision?.status).toBe('in_progress');
    expect(state.stages.final?.status).toBe('stale');
  });
});
