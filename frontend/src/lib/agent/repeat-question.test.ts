import { describe, expect, it } from 'vitest';

import { questionOverlap, repeatedQuestion, repeatPause, SAME_QUESTION, type AskedStep } from './repeat-question';

/**
 * 4 Nov (Sean, Lakeside proposal, run d1bd9ea9): Go asked steps 10, 15 and 19
 * — the same point, after an answer each time, naming the same button. These
 * are the questions as asked on production.
 */
const Q10 =
  'The proposal still ends with four internal notes that must come out of the document, and it may be slightly over 650 words. Should I remove the notes and trim the wording to fit the limit, keeping every figure, table and section unchanged? There is no button that starts this edit from my side. Pressing "Refine: make it shorter" under "More" at the bottom of the stage would do it.';
const Q15 =
  "The final proposal still ends with an 'Outside the proposal' note after section 7, which should not reach the operations director. How do you want it removed? Your earlier approval was given on version 3, so please re-confirm it once the line is gone. Approving the document does not authorise sending it, booking the workshop or spending money.";
const Q19 =
  "How do you want the notes block after section 7 removed? Everything from the blank line and 'Notes for you, outside the proposal:' to the end comes out, and sections 1 to 7 stay as they are. One option is to press \"Refine: make it shorter\" under \"More\" at the bottom of the stage, but it may also reword sections 1 to 7, so check them afterwards. Once the block is gone, please re-approve the proposal. Approving the document does not authorise sending it, booking the workshop or spending money. No further drafting pass is needed after this unless you change a fact.";

const SHORTER = 'Refine: make it shorter';
const at = (minute: number) => `2026-11-04T12:${String(minute).padStart(2, '0')}:00Z`;
const ask = (q: string, minute: number, control = SHORTER): AskedStep => ({
  action_key: 'request_user_decision', stage_id: 'final_proposal', decision_question: q, params: { control }, started_at: at(minute), finished_at: at(minute),
});
const answer = (a: string, minute: number): AskedStep => ({ action_key: 'user_answer', stage_id: 'final_proposal', output: a, started_at: at(minute), finished_at: at(minute) });
const revise = (minute: number): AskedStep => ({ action_key: 'revise_stage', stage_id: 'final_proposal', cost_usd: 0.16, started_at: at(minute), finished_at: at(minute) });

const RUN: AskedStep[] = [
  ask(Q10, 11),
  answer('Remove the notes and trim to 650 words, keeping all figures', 17),
  revise(17), revise(17), revise(18),
];

describe('a question Go already asked (4 Nov, Lakeside)', () => {
  it('Q15 repeats Q10: same stage, answered, the same button, nothing the user changed since', () => {
    const r = repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN });
    expect(r).toMatchObject({ answer: 'Remove the notes and trim to 650 words, keeping all figures', moves: 3 });
    expect(r!.spent).toBeCloseTo(0.48);
  });

  it('Q19 repeats Q15 by its words alone, whatever button it names', () => {
    expect(questionOverlap(Q15, Q19)).toBeGreaterThanOrEqual(SAME_QUESTION);
    const steps = [...RUN, ask(Q15, 18), answer('Do whatever is best', 20), revise(20), revise(21)];
    const r = repeatedQuestion({ question: Q19, control: null, stageId: 'final_proposal', steps });
    expect(r).toMatchObject({ answer: 'Do whatever is best', moves: 2 });
    expect(r!.asked).toBe(Q15);
  });

  it('a question never answered is not a repeat: the user resumed without answering it', () => {
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: [ask(Q10, 11), revise(12)] })).toBeNull();
  });

  it('nor one on another stage', () => {
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'draft_proposal', steps: RUN })).toBeNull();
  });

  it('nor one asked again after the user changed the stage themselves', () => {
    const versions = [{ source_operation: 'stage_edit', created_at: at(19) }];
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN, versions })).toBeNull();
    // Go's own version is not the user's change.
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN, versions: [{ source_operation: 'agent_revise', created_at: at(19) }] })).not.toBeNull();
  });

  it('nor after a fact the user added — but the answer recorded as a fact is the answer, not a change', () => {
    const own = [{ created_at: at(19), accepted_by: 'user', source_ref: { via: 'revision' }, retired_at: null }];
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN, facts: own })).toBeNull();
    const fromAnswer = [{ created_at: at(17), accepted_by: 'user', source_ref: { via: 'go answer' }, retired_at: null }];
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN, facts: fromAnswer })).not.toBeNull();
  });

  it('asking to approve the version Go changed on the answer is the next step, not a repeat', () => {
    const approve = 'Do you approve this current version as the finished proposal? Your earlier approval was given on an earlier version.';
    const steps = [ask(approve, 22, ''), answer('Make it shorter to leave room under 650 words', 24), revise(25)];
    const versions = [{ source_operation: 'agent_revise', created_at: at(25) }];
    expect(repeatedQuestion({ question: approve, control: null, stageId: 'final_proposal', steps, versions })).toBeNull();
    // With nothing new to approve, it is asked once.
    expect(repeatedQuestion({ question: approve, control: null, stageId: 'final_proposal', steps, versions: [] })).not.toBeNull();
    // Sean's questions were about the notes, not approval: a new version does not excuse them.
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN, versions: [{ source_operation: 'agent_revise', created_at: at(18) }] })).not.toBeNull();
  });

  it('two different questions on one stage are two questions', () => {
    const date = 'The sources disagree on the launch date (December 3 vs December 10). Which should I use?';
    const price = 'Which price should the announcement use — $18 or $24 per user per month?';
    const steps = [{ ...ask(date, 1, ''), stage_id: 's' }, { ...answer('December 10', 2), stage_id: 's' }];
    expect(questionOverlap(date, price)).toBeLessThan(SAME_QUESTION);
    expect(repeatedQuestion({ question: price, control: null, stageId: 's', steps })).toBeNull();
  });

  it('says once what was asked, what was answered and what is still open', () => {
    const r = repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN })!;
    const said = repeatPause(r, 'Final proposal', Q15);
    expect(said).toMatch(/^I asked this before — "The proposal still ends with four internal notes/);
    expect(said).toContain('you answered "Remove the notes and trim to 650 words, keeping all figures"');
    expect(said).toContain('3 moves on Final proposal since then have not settled it, so I have stopped rather than ask you again.');
    expect(said).toContain("Still open: The final proposal still ends with an 'Outside the proposal' note");
    expect(said).toMatch(/Nothing more is spent until you act/);
  });
});

describe('the pause in the interface language', () => {
  it('is recognised as a stop reason and shown translated', async () => {
    const { shownStopReason } = await import('@/lib/i18n/stop-reasons');
    const r = repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN })!;
    const said = repeatPause(r, 'Final proposal', Q15);
    expect(shownStopReason('es', said)).toMatch(/^Ya te pregunté esto/);
    expect(shownStopReason('en', said)).toBe(said);
  });
});
