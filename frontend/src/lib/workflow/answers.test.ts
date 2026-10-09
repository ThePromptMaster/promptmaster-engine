import { describe, expect, it } from 'vitest';

import { answerAsFact, answerDocuments, questionOf } from './answers';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import { factSource } from './facts';

const ref = { run_id: 'r1', step_id: 's1', stage_id: 'review' };

describe('an answer to Go is recorded as a decision (Sean, 7 Oct, emails 8 and 11)', () => {
  it('records the question and the answer, citing the run', () => {
    const fact = answerAsFact(
      'The sources disagree on the launch date (December 3 vs December 10) and the price ($18 vs $24). Which should I use?\n\nThe button is "Answer and continue", below.',
      'December 10, and $18 per user per month',
      ref
    )!;
    expect(fact.statement).toBe(
      'Decided by the user — asked "The sources disagree on the launch date (December 3 vs December 10) and the price ($18 vs $24). Which should I use?", answered: December 10, and $18 per user per month'
    );
    expect(fact).toMatchObject({ kind: 'fact', source_kind: 'user_edit', source_ref: { via: 'go answer', run_id: 'r1', stage_id: 'review' } });
  });

  it('an answer that decides nothing is not a fact', () => {
    for (const a of ['ok', 'Yes.', 'go ahead', 'continue', '  ']) expect(answerAsFact('Shall I?', a, ref)).toBeNull();
  });

  it('keeps the question short and drops the button pointer', () => {
    expect(questionOf('Which date?\n\nThe button is "X".')).toBe('Which date?');
    expect(questionOf('q '.repeat(500)).length).toBeLessThanOrEqual(600);
  });

  it('reads as "your answer to Go" in the facts list', () => {
    const fact = answerAsFact('Which date?', 'January 15, 2027', ref)!;
    expect(factSource({ source_kind: fact.source_kind, source_ref: fact.source_ref ?? {}, created_at: '2026-10-07T10:00:00Z', accepted_by: 'user' })).toBe(
      'your answer to Go, 7 Oct'
    );
  });
});

describe('an answer is read against the saved record (L-65, 9 Oct)', () => {
  it('every stage\'s latest saved text, labelled and versioned, in workflow order', () => {
    const v = (id: string, n: number, content: string) => ({ id, version_number: n, content }) as never;
    const bundles = {
      output: { artifact: null, versions: [v('o1', 1, 'Old'), v('o2', 2, 'Launch: December 10.')] },
      input: { artifact: null, versions: [v('i1', 1, 'Brief text.')] },
    } as never;
    const docs = answerDocuments(SINGLE_OUTPUT_V1, bundles);
    expect(docs.map((d) => [d.version, d.text])).toEqual([[1, 'Brief text.'], [2, 'Launch: December 10.']]);
    expect(docs.every((d) => d.label.length > 0)).toBe(true);
  });
  it('a fact recorded over a contradiction keeps the quote it overrode', () => {
    const fact = answerAsFact('Is n = 5 checked?', 'Yes, in the Experiment record.', { ...ref, contradicted: { document: 'Experiment', quote: 'n = 5 not run' } })!;
    expect(fact.source_ref).toMatchObject({ contradicted: { document: 'Experiment', quote: 'n = 5 not run' } });
  });
});
