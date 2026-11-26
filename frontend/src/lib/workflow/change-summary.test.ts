/**
 * After a change, what still stands, what is being redone, and what needs the user
 * (L-277; 22 Nov, Sean: "which parts of the plan they can still use, which need to
 * be redone, and what genuinely needs their judgment").
 */
import { describe, expect, it } from 'vitest';

import { changeSummary, decisionStillAwaited, type ChangeSummaryInput } from './change-summary';
import { plainReason } from './plain-reason';
import { setAsideLater, setAsideReason } from './approvals';
import { recordDecisionReason } from './decision-options';

const ORDER = ['brief', 'costs', 'draft', 'check', 'approve', 'final'];
const template = { stages: ORDER.map((id) => ({ id, label: id, exit_criteria: [] })) } as never;
const SINCE = '2026-11-22T20:00:00Z';
const later = (m: number) => `2026-11-22T20:${String(m).padStart(2, '0')}:00Z`;
const B = { stageId: 'approve', criterionId: 'approve.approved', choice: 'Option B: $20,625 all-in', because: 'Option B: card readers $1,975' };

function input(over: Partial<ChangeSummaryInput>): ChangeSummaryInput {
  return {
    template, state: { stages: {} }, events: [], since: SINCE, touched: [], outcomes: [], reapprove: {}, queue: [], manualChecks: {},
    ...over,
  } as ChangeSummaryInput;
}

describe('the demo: Option B\'s card readers change after B was chosen', () => {
  const change = { type: 'brief_changed', stage_id: 'final', created_at: SINCE, payload: { kind: 'fact', affected: [], decisions_set_aside: [B] } };

  it('right after the change: the brief stands, the work that used the quote waits, and the choice is the user\'s again', () => {
    const s = changeSummary(input({
      state: { stages: {
        brief: { status: 'completed_with_artifact' },
        costs: { status: 'stale', stale: { reason: 'It states "Option B: card readers $1,975", which changed: "B total $20,625"', since: SINCE, was: 'completed_with_artifact' } },
        draft: { status: 'stale', stale: { reason: 'It states "Option B: card readers $1,975", which changed: "…"', since: SINCE, was: 'completed_with_artifact' } },
        check: { status: 'completed_with_artifact' },
        approve: { status: 'stale', stale: { reason: setAsideReason(B), since: SINCE, was: 'in_progress' } },
        final: { status: 'stale', stale: { reason: `It states "Option B: card readers $1,975", which changed: "…" ${setAsideLater(B)}`, since: SINCE, was: 'completed_with_artifact' } },
      } } as never,
      events: [change] as never,
      touched: ['costs', 'draft', 'approve', 'final'],
      manualChecks: { 'approve.approved': false },
    }));
    // 26 Nov (L-292): the check comes after the costs still waiting, so it is not usable yet:
    // the costs' update reopens it to be checked.
    expect(s.usable.map((u) => u.stageId)).toEqual(['brief']);
    expect(s.redoing.map((r) => [r.stageId, r.state])).toEqual([['costs', 'waiting'], ['draft', 'waiting'], ['check', 'to_check'], ['final', 'waiting']]);
    expect(s.redoing[2].after).toBe('costs');
    // In the user's words, never the instruction written for the model.
    expect(s.redoing[0].reason).toBe('It uses “Option B: card readers $1,975”, which has changed.');
    expect(s.redoing[3].reason).toContain('Your choice of Option B: $20,625 all-in is set aside until you choose again.');
    expect(s.redoing.map((r) => r.reason).join(' ')).not.toMatch(/Do not present|decision of record/);
    expect(s.needsYou).toEqual([{ kind: 'decision', stageId: 'approve', choice: B.choice, because: B.because, waitingOn: ['costs', 'draft'] }]);
  });

  it('as Go works: a stage checked and kept stands again, a repaired one is redone, and the choice is ready', () => {
    const s = changeSummary(input({
      state: { stages: {
        brief: { status: 'completed_with_artifact' },
        costs: { status: 'completed_with_artifact' },
        draft: { status: 'completed_with_artifact' },
        check: { status: 'completed_with_artifact' },
        approve: { status: 'in_progress' },
        final: { status: 'stale', stale: { reason: 'x', since: SINCE, was: 'completed_with_artifact' } },
      } } as never,
      events: [change, { type: 'stage_marked_complete', stage_id: 'draft', created_at: later(5), payload: { checked_unchanged: true } }] as never,
      touched: ['costs', 'draft', 'approve', 'final'],
      outcomes: [{ stageId: 'costs', version: 3, by: 'go', check: 'clean', count: 0 }, { stageId: 'draft', version: null, by: null, check: 'clean', count: 0 }],
      manualChecks: { 'approve.approved': false },
    }));
    expect(s.usable).toEqual([{ stageId: 'brief' }, { stageId: 'draft', kept: 'checked' }, { stageId: 'check' }]);
    expect(s.redoing).toEqual([{ stageId: 'costs', state: 'updated', version: 3, by: 'go' }, { stageId: 'final', state: 'waiting', reason: 'x' }]);
    expect(s.needsYou).toEqual([{ kind: 'decision', stageId: 'approve', choice: B.choice, because: B.because, waitingOn: [] }]);
  });

  it('once chosen again, the choice no longer waits; the final memo\'s sign-off asks again', () => {
    const s = changeSummary(input({
      state: { stages: Object.fromEntries(ORDER.map((id) => [id, { status: 'completed_with_artifact' }])) } as never,
      events: [change] as never,
      touched: ['costs', 'approve', 'final'],
      outcomes: [{ stageId: 'costs', version: 3, by: 'go', check: 'clean', count: 0 }, { stageId: 'approve', version: 8, by: 'go', check: 'clean', count: 0 }, { stageId: 'final', version: 6, by: 'go', check: 'clean', count: 0 }],
      reapprove: { final: { approvals: ['I approve this memo'], version: 4, current: 6 } },
      manualChecks: { 'approve.approved': true },
    }));
    expect(s.needsYou).toEqual([{ kind: 'reapprove', stageId: 'final', version: 4, current: 6 }]);
    expect(s.redoing.map((r) => r.stageId)).toEqual(['costs', 'approve', 'final']);
  });
});

describe('what counts', () => {
  it('"Keep them as they are" keeps every reopened stage as the user chose', () => {
    const s = changeSummary(input({
      state: { stages: { brief: { status: 'completed_with_artifact' }, costs: { status: 'completed_with_artifact' } } } as never,
      events: [{ type: 'brief_change_dismissed', stage_id: 'brief', created_at: later(2), payload: { change_at: SINCE } }] as never,
      touched: ['costs'],
      outcomes: [{ stageId: 'costs', version: null, by: null, check: 'clean', count: 0 }],
    }));
    expect(s.usable).toEqual([{ stageId: 'brief' }, { stageId: 'costs', kept: 'by_you' }]);
  });

  it('a stage reopened later by a repair before it counts as reopened; unstarted work is in no group', () => {
    const s = changeSummary(input({
      state: { stages: { brief: { status: 'completed_with_artifact' }, costs: { status: 'stale', stale: { reason: 'Brief was changed (now v2) after this stage used it.', since: later(3), was: 'completed_with_artifact' } }, draft: { status: 'not_started' } } } as never,
      touched: ['brief'],
      outcomes: [{ stageId: 'brief', version: 2, by: 'you', check: 'none', count: 0 }],
    }));
    expect(s.redoing.map((r) => [r.stageId, r.state])).toEqual([['brief', 'updated'], ['costs', 'waiting']]);
    expect(s.usable).toEqual([]);
  });

  it('only what is at or after the change point needs the user, and a set-aside approval is not listed twice', () => {
    const s = changeSummary(input({
      state: { stages: { brief: { status: 'completed_with_artifact' }, costs: { status: 'stale', stale: { reason: 'r', since: SINCE, was: 'completed_with_artifact' } }, approve: { status: 'in_progress' } } } as never,
      events: [{ type: 'brief_changed', stage_id: 'brief', created_at: SINCE, payload: { decisions_set_aside: [B] } }] as never,
      touched: ['costs'],
      reapprove: { brief: { approvals: ['I approve the brief'], version: 1, current: 2 } },
      queue: [
        { id: 'a', kind: 'approval', stageId: 'approve', stageLabel: 'Approve', text: 'I choose the vendor', criterionId: 'approve.approved', holdsUp: [], blocksFinish: true },
        { id: 'f', kind: 'finding', stageId: 'check', stageLabel: 'Check', text: 'f3: the total is off by $50', holdsUp: [], blocksFinish: true },
      ] as never,
    }));
    expect(s.needsYou.map((n) => n.kind)).toEqual(['decision', 'question']);
  });
});

describe('a reason in the user\'s words (L-277)', () => {
  it('the code\'s instructions read as what happened; anything else as written', () => {
    expect(plainReason(setAsideReason(B))).toBe('You chose Option B: $20,625 all-in. It rested on “Option B: card readers $1,975”, which has changed, so the choice is set aside until you choose again.');
    expect(plainReason(recordDecisionReason('Option A'))).toBe('Your decision, Option A, is being written in.');
    expect(plainReason('Costs was changed (now v3) after this stage used it.')).toBe('Costs was changed (now v3) after this stage used it.');
    expect(plainReason('')).toBe('');
  });
});

describe('the summary stays while the set-aside choice waits (L-277 follow-up)', () => {
  const set = { type: 'brief_changed', stage_id: 'final', created_at: SINCE, payload: { kind: 'fact', affected: [{ stage_id: 'costs' }, { stage_id: 'approve' }, { stage_id: 'final' }], decisions_set_aside: [B] } };
  const now = Date.parse(SINCE) + 60_000;
  it('is the change, with its stages, until the choice is made again', () => {
    expect(decisionStillAwaited([set] as never, { 'approve.approved': false }, now, 12 * 3600_000)).toEqual({ event: set, stageIds: ['costs', 'approve', 'final'] });
    expect(decisionStillAwaited([set] as never, { 'approve.approved': true }, now, 12 * 3600_000)).toBeNull();
    expect(decisionStillAwaited([set] as never, {}, now + 13 * 3600_000, 12 * 3600_000)).toBeNull();
    expect(decisionStillAwaited([{ ...set, payload: { kind: 'fact', affected: [] } }] as never, {}, now, 12 * 3600_000)).toBeNull();
  });
});

describe('a stage Go repaired because of the change is redone, not untouched (production pass)', () => {
  it('a check repaired after the costs changed is listed with its new version', () => {
    const s = changeSummary(input({
      state: { stages: { brief: { status: 'completed_with_artifact' }, costs: { status: 'completed_with_artifact' }, check: { status: 'completed_with_artifact' } } } as never,
      events: [{ type: 'stage_marked_complete', stage_id: 'check', created_at: later(4), payload: { repaired_after: 'Costs was changed (now v2) after this stage used it.' } }] as never,
      touched: ['costs'],
      outcomes: [{ stageId: 'costs', version: 2, by: 'go', check: 'clean', count: 0 }, { stageId: 'check', version: 4, by: 'go', check: 'table', count: 0 }, { stageId: 'brief', version: null, by: null, check: 'none', count: 0 }],
    }));
    expect(s.usable).toEqual([{ stageId: 'brief' }]);
    expect(s.redoing.map((r) => [r.stageId, r.state, r.version])).toEqual([['costs', 'updated', 2], ['check', 'updated', 4]]);
  });
});



describe('one date several stages rely on, and who already has which version (26 Nov, L-288/L-289/L-292)', () => {
  const OPS = ['brief', 'timeline', 'staffing', 'budget', 'commitment', 'plan'];
  const ops = { stages: OPS.map((id) => ({ id, label: id, exit_criteria: [] })) } as never;
  const stale = { status: 'stale', stale: { reason: 'It states "delivers on March 3, 2027", which changed: "…"', since: SINCE, was: 'completed_with_artifact' } };
  const done = { status: 'completed_with_artifact' };

  it('right after the date changed: what quotes it waits, what comes after the first of them will be checked, the brief stands', () => {
    const s = changeSummary(input({
      template: ops,
      state: { stages: { brief: done, timeline: stale, staffing: stale, budget: done, commitment: done, plan: stale } } as never,
      touched: ['timeline', 'staffing', 'plan'],
    }));
    expect(s.usable.map((u) => u.stageId)).toEqual(['brief']);
    expect(s.redoing.map((r) => [r.stageId, r.state, r.after ?? null])).toEqual([
      ['timeline', 'waiting', null], ['staffing', 'waiting', null], ['budget', 'to_check', 'timeline'], ['commitment', 'to_check', 'timeline'], ['plan', 'waiting', null],
    ]);
  });

  it('"Keep them as they are" leaves nothing to check', () => {
    const s = changeSummary(input({
      template: ops,
      state: { stages: { brief: done, timeline: done, staffing: done, budget: done, commitment: done, plan: done } } as never,
      events: [{ type: 'brief_change_dismissed', stage_id: 'plan', created_at: later(1), payload: {} }] as never,
      touched: ['timeline', 'staffing', 'plan'],
    }));
    expect(s.redoing.filter((r) => r.state === 'to_check')).toEqual([]);
  });

  it('a stage whose readers have an older version: said with its re-approval, or on its own', () => {
    const sentBehind = [
      { stageId: 'commitment', sent: { recordId: 'r1', stageId: 'commitment', versionId: 'c1', versionNumber: 1, to: 'Bayview Grocers', on: '2026-11-26', at: later(0) }, current: 2, changes: [] },
      { stageId: 'staffing', sent: { recordId: 'r2', stageId: 'staffing', versionId: 's1', versionNumber: 1, to: 'Harbor Crew Hire', on: '2026-11-26', at: later(0) }, current: 2, changes: [] },
    ];
    const s = changeSummary(input({
      template: ops,
      state: { stages: { brief: done, timeline: done, staffing: done, budget: done, commitment: done, plan: done } } as never,
      touched: ['timeline', 'staffing', 'plan'],
      reapprove: { commitment: { approvals: ['I approve this commitment to send to Bayview Grocers'], version: 1, current: 2 } },
      sentBehind,
    }));
    expect(s.needsYou).toEqual([
      { kind: 'reapprove', stageId: 'commitment', version: 1, current: 2, sent: { to: 'Bayview Grocers', version: 1 } },
      { kind: 'resend', stageId: 'staffing', to: 'Harbor Crew Hire', version: 1, current: 2 },
    ]);
  });
});
