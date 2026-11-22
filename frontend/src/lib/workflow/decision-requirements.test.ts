/**
 * 22 Nov, Sean's warehouse test (project 20065349, run 4bf169cf): an option over a
 * hard cap was a button like the others (L-274), and a typed "Approve Option B"
 * stayed a note beside his later press on Option A (L-275).
 */
import { describe, expect, it } from 'vitest';

import type { ProjectFact } from '@/types/project';
import { answeredText, answersReplacedBy, replacedReason } from './approvals';
import {
  choosesAnOption, decisionCandidates, decisionForAnswer, eligibleOptions, failingChoice, type DecisionOption,
} from './decision-options';

const CAP = 'Hard cap of $50,000 all-in, including a mandatory $5,000 contingency.';
const A: DecisionOption = {
  label: 'Option A: $52,000 all-in, live December 17 (over the $50,000 cap)',
  quote: '$52,000 ($36,000 + $11,000 + $5,000)',
  fails: { requirement: CAP, quote: 'Ineligible: $2,000 over the cap ($52,000 − $50,000)' },
};
const B: DecisionOption = { label: 'Option B: $49,000 all-in, live December 18', quote: '$49,000 ($38,000 + $6,000 + $5,000)' };

describe('an option its stage shows failing a requirement is not offered (L-274)', () => {
  it('only the eligible options can be chosen', () => {
    expect(eligibleOptions([A, B])).toEqual([B]);
  });

  it('pressed, or typed by name, the failing option is caught; the eligible one is not', () => {
    expect(failingChoice(A.label, [A, B])).toBe(A);
    expect(failingChoice('Approve Option A at $52,000', [A, B])).toBe(A);
    expect(failingChoice('Option B', [A, B])).toBeNull();
    expect(failingChoice('Something else entirely', [A, B])).toBeNull();
    expect(failingChoice('Option A or Option B', [A, B])).toBeNull();
  });

  it('a typed answer naming the failing option is matched with its failure, so it is refused', () => {
    const made = decisionForAnswer('Approve Option A at $52,000', [{ criterionId: 'approve.approved', stageId: 'approve', options: [A, B] }]);
    expect(made?.choice).toBe(A.label);
    expect(made?.fails?.requirement).toBe(CAP);
  });
});

describe('a typed choice is the decision (L-275)', () => {
  it('Sean\'s 13:54 answer decides an approval already given for Option A, because it chooses', () => {
    const made = decisionForAnswer('Approve Option B at $49,000 all-in', [{ criterionId: 'approve.approved', stageId: 'approve', options: [A, B], given: true }]);
    expect(made).toEqual({ criterionId: 'approve.approved', stageId: 'approve', choice: B.label, fails: null });
  });

  it('an aside that only names an option does not change a decision already given', () => {
    expect(decisionForAnswer('What does Option B cost?', [{ criterionId: 'c', stageId: 's', options: [A, B], given: true }])).toBeNull();
    // Waiting, the narrow rule of 12 Nov still applies: the answer names one option.
    expect(decisionForAnswer('Option B', [{ criterionId: 'c', stageId: 's', options: [A, B] }])?.choice).toBe(B.label);
  });

  it('choosing words', () => {
    for (const t of ['Approve Option B', 'I approved B', 'go with Option B', 'Pick B', 'I choose B', 'decide on B', 'We opt for B']) expect(choosesAnOption(t)).toBe(true);
    for (const t of ['What does Option B cost?', 'Option B is cheaper', 'Is A over the cap?']) expect(choosesAnOption(t)).toBe(false);
  });

  it('candidates: an approval decided by choosing before, ticked or not, or one worded as a choice; never a delegable one or a sign-off', () => {
    const template = {
      stages: [
        { id: 'approve', label: 'Approve an option', renderer: 'prose', exit_criteria: [
          { id: 'approve.approved', label: 'I approve this option', check: 'manual', authority: 'reserved' },
          { id: 'approve.written', label: 'It is written', check: 'manual', authority: 'delegable' },
        ] },
        { id: 'final', label: 'Final memo', renderer: 'prose', exit_criteria: [{ id: 'final.approved', label: 'I approve the memo', check: 'manual', authority: 'reserved' }] },
        { id: 'pick', label: 'Pick', renderer: 'prose', exit_criteria: [{ id: 'pick.approved', label: 'I choose the vendor', check: 'manual', authority: 'reserved' }] },
      ],
    } as never;
    const v = (id: string) => ({ versions: [{ id, content: 'text' }] }) as never;
    const facts = [{ source_ref: { criterion_id: 'approve.approved', choice: 'Option A: $48,000' } }];
    const out = decisionCandidates(template, { approve: v('v6'), final: v('f5'), pick: v('p1') }, { 'approve.approved': true }, facts);
    expect(out.map((c) => [c.criterionId, c.given, c.versionId])).toEqual([['approve.approved', true, 'v6'], ['pick.approved', false, 'p1']]);
  });
});

describe('a decision replaces the answers that chose before it (L-275)', () => {
  const fact = (id: string, statement: string, source_ref: Record<string, unknown>, retired_at: string | null = null) =>
    ({ id, statement, source_ref, retired_at }) as Pick<ProjectFact, 'id' | 'statement' | 'source_ref' | 'retired_at'>;
  // Sean's three facts, as saved.
  const answerB = fact('5953a6fb', 'Decided by the user — asked "Do you approve Option B at $49,000 all-in, including the $5,000 contingency, with all sites live December 18? You can record this on the Approve option stage, using "Go back to Approve option" under "More".", answered: Approve Option B at $49,000 all-in', { via: 'go answer', run_id: '4bf169cf', step_id: '87d4dfb7', stage_id: 'finalize_the_memo' });
  const pressA = fact('eef2947c', 'Decided by the user — on "I choose the labeling option to approve" (Approve option): Option A: $52,000 all-in, live December 17 (over the $50,000 cap)', { via: 'go answer', criterion_id: 'approve_an_option.approved', choice: 'Option A: $52,000 all-in, live December 17 (over the $50,000 cap)' });
  const oldA = fact('5ab5e935', 'Decided by the user — on "I choose the labeling option to approve" (Approve option): Option A: $48,000 all-in, all sites live December 17. That price no longer holds', { via: 'revision', criterion_id: 'approve_an_option.approved' }, '2026-11-22T14:04:29Z');

  it('the typed B answer is replaced by a decision on an option; the decision facts themselves are not', () => {
    expect(answersReplacedBy([answerB, pressA, oldA], 'Option A: $52,000 all-in').map((f) => f.id)).toEqual(['5953a6fb']);
    expect(answersReplacedBy([answerB], 'Option B: $49,000 all-in').map((f) => f.id)).toEqual(['5953a6fb']);
  });

  it('an answer that only mentions an option, or names no item of the kind, stays', () => {
    const aside = fact('x1', 'Decided by the user — asked "Anything else?", answered: Option C is out of scope', { via: 'go answer' });
    const other = fact('x2', 'Decided by the user — asked "Which site first?", answered: Approve Site 3 first', { via: 'go answer' });
    expect(answersReplacedBy([aside, other], 'Option B: $49,000')).toEqual([]);
    expect(answersReplacedBy([answerB], 'Not yet decided')).toEqual([]);
  });

  it('reads the answer, not the question, and says why it was retired', () => {
    expect(answeredText(answerB.statement)).toBe('Approve Option B at $49,000 all-in');
    expect(replacedReason('I choose the labeling option to approve', 'Option B')).toBe('Replaced by your decision on "I choose the labeling option to approve": Option B');
  });
});

describe('a decision stage already waiting for its choice to be recorded is re-marked when that choice is set aside (L-275)', () => {
  it('the set-aside reason replaces "record the decision", and the stage reopens as in progress', async () => {
    const { projectState } = await import('./engine');
    const T = { key: 't', stages: ['draft', 'decision', 'final'].map((id) => ({ id, label: id, exit_criteria: [], transitions: {} })) } as never;
    const at = (n: number) => `2026-11-22T19:0${n}:00Z`;
    const ev = (seq: number, type: string, stage_id: string, payload: Record<string, unknown> = {}) => ({ seq, type, stage_id, payload, created_at: at(seq), actor: 'system' });
    const events = [
      ev(1, 'stage_marked_complete', 'draft'), ev(2, 'stage_marked_complete', 'decision'), ev(3, 'stage_marked_complete', 'final'),
      // The press: the decision stage waits for Go to write the choice in.
      ev(4, 'brief_changed', 'decision', { kind: 'answer', affected: [{ stage_id: 'decision', reason: 'the user has decided: "Option A"' }] }),
      // Before Go gets there, Option A's quote changes.
      ev(5, 'brief_changed', 'final', {
        kind: 'fact', affected: [{ stage_id: 'decision', reason: 'set aside' }],
        decisions_set_aside: [{ stageId: 'decision', criterionId: 'decision.approved', choice: 'Option A', because: 'Option A: …' }],
      }),
    ];
    const state = projectState(T, events as never);
    expect(state.stages.decision?.status).toBe('stale');
    expect(state.stages.decision?.stale?.reason).toBe('set aside');
    expect(state.stages.decision?.stale?.was).toBe('in_progress');
  });

  it('a stale stage not set aside keeps its first reason, as before', async () => {
    const { projectState } = await import('./engine');
    const T = { key: 't', stages: ['a', 'b'].map((id) => ({ id, label: id, exit_criteria: [], transitions: {} })) } as never;
    const ev = (seq: number, type: string, stage_id: string, payload: Record<string, unknown> = {}) => ({ seq, type, stage_id, payload, created_at: `2026-11-22T19:0${seq}:00Z`, actor: 'system' });
    const state = projectState(T, [
      ev(1, 'stage_marked_complete', 'a'), ev(2, 'stage_marked_complete', 'b'),
      ev(3, 'brief_changed', 'b', { affected: [{ stage_id: 'b', reason: 'first' }] }),
      ev(4, 'brief_changed', 'b', { affected: [{ stage_id: 'b', reason: 'second' }] }),
    ] as never);
    expect(state.stages.b?.stale?.reason).toBe('first');
  });
});
