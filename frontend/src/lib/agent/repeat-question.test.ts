import { describe, expect, it } from 'vitest';

import { asksForApproval, questionOverlap, repeatedQuestion, repeatPause, SAME_QUESTION, type AskedStep } from './repeat-question';

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

  it('an approval asked after a sentence saying what changed is still an approval (4 Nov, prod)', () => {
    const first = 'Do you approve this version, with Section 7 now a single sentence, as the finished proposal? As before, approval does not authorise sending it, booking a workshop or spending money.';
    const next = 'Section 6 now lists the items to confirm in alphabetical order. Do you approve this version as the finished proposal? As before, approval does not authorise sending it, booking a workshop or spending money.';
    expect(asksForApproval(next)).toBe(true);
    const steps = [ask(first, 22, ''), answer('Not yet: in Section 6, list the items to confirm in alphabetical order, then I will approve.', 24), revise(25)];
    const versions = [{ source_operation: 'agent_revise', created_at: at(25) }];
    expect(repeatedQuestion({ question: next, control: null, stageId: 'final_proposal', steps, versions })).toBeNull();
  });

  it("a statement about approval around another question is not an approval ask (Sean's notes questions)", () => {
    expect(asksForApproval(Q15)).toBe(false);
    expect(asksForApproval(Q19)).toBe(false);
    expect(asksForApproval('Approve it? \n\nOr not.')).toBe(true);
    expect(asksForApproval('How should the notes come out?\n\nDo you approve the rest?')).toBe(false);
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
    expect(said).toMatch(/^The next step here is yours: "Refine: make it shorter"\./);
    expect(said).toContain('3 moves on Final proposal since your last answer have not changed that');
    expect(said).toContain("I was going to ask: The final proposal still ends with an 'Outside the proposal' note");
    expect(said).not.toContain('The proposal still ends with four internal notes');
    expect(said).toMatch(/Nothing more is spent until you act/);
  });

  it('a question in the same words quotes what was asked and answered', () => {
    const steps = [...RUN, ask(Q15, 18), answer('Do whatever is best', 20), revise(20), revise(21)];
    const r = repeatedQuestion({ question: Q19, control: null, stageId: 'final_proposal', steps })!;
    expect(r.byButton).toBe(false);
    const said = repeatPause(r, 'Final proposal', Q19);
    expect(said).toMatch(/^I asked this before — "The final proposal still ends/);
    expect(said).toContain('you answered "Do whatever is best"');
    expect(said).toContain('Still open: How do you want the notes block');
    expect(said).toContain('tell me what to do differently here.');
  });
});

describe('a different question naming the same button (5 Nov, a research project)', () => {
  const CHECK = 'I have checked this derivation and approve the next stage building on it';
  const CONVENTION = 'In your note, does the symbol mean the product of differences, so that its square has degree 20, or the discriminant itself?';
  const NEXT = 'You have now seen the lift argument and the passing structural checks. How do you want to proceed?';
  const steps = [ask(CONVENTION, 1, CHECK), answer('Do whatever is best', 2), revise(3), revise(4)];

  it('is not said to be the earlier question: it says what is left is theirs, under that button', () => {
    const r = repeatedQuestion({ question: NEXT, control: CHECK, stageId: 'final_proposal', steps })!;
    expect(r.byButton).toBe(true);
    const said = repeatPause(r, 'Thread derivations', NEXT);
    expect(said).toContain(`The next step here is yours: "${CHECK}"`);
    expect(said).toContain('I was going to ask: You have now seen the lift argument');
    expect(said).not.toContain('discriminant');
  });
});

describe('an answer in the user\'s own words after a pause', () => {
  it('lets the question be asked once more: that is new to go on', () => {
    const steps = [...RUN, answer('Take the notes out and leave the figures as they are', 19)];
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps })).toBeNull();
  });

  it('"Do whatever is best" is not new to go on', () => {
    const steps = [...RUN, answer('Do whatever is best', 19)];
    expect(repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps })).not.toBeNull();
  });
});

describe('the pause in the interface language', () => {
  it('is recognised as a stop reason and shown translated', async () => {
    const { shownStopReason } = await import('@/lib/i18n/stop-reasons');
    const r = repeatedQuestion({ question: Q15, control: SHORTER, stageId: 'final_proposal', steps: RUN })!;
    const said = repeatPause(r, 'Final proposal', Q15);
    expect(shownStopReason('es', said)).toMatch(/^El siguiente paso aquí es tuyo/);
    expect(shownStopReason('en', said)).toBe(said);
    const words = repeatPause({ ...r, byButton: false }, 'Final proposal', Q15);
    expect(shownStopReason('es', words)).toMatch(/^Ya te pregunté esto/);
  });
});
