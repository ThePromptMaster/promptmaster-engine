import { describe, expect, it } from 'vitest';

import { projectMemory } from '@/lib/agent/memory';
import { answerAsFact, chosenFrom, delegatedFact, delegatedQuestion, delegatedWhy, DELEGATED_ANSWER, DELEGATED_RULE, isDelegatedWhy, settlesInTheText } from './answers';
import { factSource } from './facts';
import { asksForRemovals } from './preservation';

/**
 * 5 Nov (a research project): "Do whatever is best" wrote one step and nothing else.
 * The moves after it were checks that never read it; Go named its choice once, in a
 * rationale; the document went on saying "Unresolved. The researcher should state both."
 */
const QUESTION = 'In your note, does the symbol mean the product of differences, so that its square has degree 20, or the discriminant itself, with degree 40?';
const DRAFT = 'The lift argument. The note speaks of the symbol squared dividing the residual. If the symbol means the product of differences, its square has degree 20. If it means the discriminant itself, the degree is 40. Unresolved.';

describe('a question the text can settle', () => {
  it('is one whose words are in the text', () => {
    expect(settlesInTheText(QUESTION, ['The product of differences (degree 20)', 'The discriminant (degree 40)', 'I need to recheck the note'], DRAFT)).toBe(true);
    expect(settlesInTheText('Which supplier should the budget use for the second site?', undefined, DRAFT)).toBe(false);
  });

  it('is not one whose choices only the user can carry out', () => {
    const choices = ["I'll attach the paper so its formulas can be filled in", "I'll enter the formulas myself", "I've checked the argument and approve building on it"];
    expect(settlesInTheText(QUESTION, choices, DRAFT)).toBe(false);
  });

  it('is not one with no text yet', () => {
    expect(settlesInTheText(QUESTION, undefined, '')).toBe(false);
  });
});

describe('what reopening the stage tells the repair', () => {
  const why = delegatedWhy(QUESTION);

  it('carries the question, and is recognised', () => {
    expect(isDelegatedWhy(why)).toBe(true);
    expect(isDelegatedWhy('The final pack states 12 pilot accounts.')).toBe(false);
    expect(delegatedQuestion(why)).toBe(QUESTION);
  });

  it('asks for no removal, so the check on what a revision drops stays on, and names the question so its own lines are exempt', () => {
    expect(asksForRemovals(why)).toBe(false);
    expect(why).toContain('product of differences');
  });

  it('tells the writer to decide, leave nothing open, and say the choice in the note', () => {
    expect(DELEGATED_RULE).toContain('DECIDE IT NOW');
    expect(DELEGATED_RULE).toContain('lists it as unresolved');
    expect(DELEGATED_RULE).toContain('begin with "Chosen: "');
  });
});

describe('the choice on record', () => {
  it('is read from the note', () => {
    expect(chosenFrom('Chosen: the product of differences, so degree 20. Why: the lift needs it.')).toBe('the product of differences, so degree 20.');
    expect(chosenFrom('Some preamble.\nChosen: degree 20\nMore.')).toBe('degree 20');
    expect(chosenFrom('I kept everything as it was.')).toBeNull();
    expect(chosenFrom(null)).toBeNull();
  });

  it('is said apart from what the user said, and the answer itself still records nothing', () => {
    expect(answerAsFact(QUESTION, DELEGATED_ANSWER, { run_id: 'r', stage_id: 's' })).toBeNull();
    const fact = delegatedFact(QUESTION, 'the product of differences', { run_id: 'r', stage_id: 's', version_id: 'v' });
    expect(fact.statement).toMatch(/^Chosen by Go when you left it to Go — asked "In your note/);
    expect(fact.statement).toMatch(/: the product of differences$/);
    expect(fact.origin).toBe('model_assumed');
    expect(fact.source_ref).toMatchObject({ via: 'go answer', delegated: true, stage_id: 's', version_id: 'v' });
    expect(factSource({ source_kind: 'user_edit', source_ref: fact.source_ref ?? {}, created_at: '2026-11-05T00:00:00Z', accepted_by: 'user', origin: 'model_assumed' })).toBe('chosen by Go when you left it to Go, 5 Nov');
  });
});

describe('what the planner is told', () => {
  it('keeps the meaning within the line limit, where "tell me what you chose" used to be cut off', () => {
    const steps = [
      { action_key: 'request_user_decision', decision_question: QUESTION, output: QUESTION, params: {} },
      { action_key: 'user_answer', output: DELEGATED_ANSWER, params: {} },
    ] as never;
    const [line] = projectMemory({ events: [], recommendations: [], steps, template: { stages: [] } } as never);
    expect(line.length).toBeLessThanOrEqual(240);
    expect(line).toContain('the user left it to you: choose now and say so in your note');
  });
});
