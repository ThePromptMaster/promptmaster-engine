import { describe, expect, it } from 'vitest';

import { cutToFitQuestions } from './perform';

/**
 * 31 Oct (Sean): "The recorded reason combines two problems into one garbled
 * sentence: 'Meeting Results called calculated or verified have the evidence
 * — measured 1 called verified with no source cited… would drop the
 * "Education" heading … Should the limit change, or should Book manuscript be
 * cut to fit…'". Each is now its own plain question.
 */
describe('a repair that would cut headings asks one plain question per reason', () => {
  const evidence = 'Results called calculated or verified have the evidence — measured 1 called verified with no source cited ("Established means …") — call each reasoned, conditional or speculative instead, or cite what backs it';
  const limit = 'Book manuscript: at most 85,000 words — measured 92,410 words';

  it('the limit and the evidence are separate numbered questions', () => {
    const { question, questions } = cutToFitQuestions({
      label: 'Book manuscript', kept: 'v8', limits: [limit],
      dropped: ['the "Education" heading', 'the "Migration and growth" heading'], evidence: [evidence],
    });
    expect(questions).toHaveLength(2);
    expect(questions[0]).toBe(
      'The limit Book manuscript: at most 85,000 words — measured 92,410 words. Meeting it would drop the "Education" heading, the "Migration and growth" heading. Should the limit change, or should Book manuscript be cut to fit even if those go?'
    );
    expect(questions[1]).toBe(
      'Separately, results are called calculated or verified with nothing behind them: 1 called verified with no source cited ("Established means …"). Should I cite what backs each one, or call them reasoned instead?'
    );
    expect(question).toBe(`I have not saved a new version of Book manuscript; v8 stays as it is. 2 things need you:\n1. ${questions[0]}\n2. ${questions[1]}`);
    // Never the old run-on form.
    expect(question).not.toMatch(/Meeting Results called/);
  });

  it('one reason is one sentence, with no list', () => {
    const { question, questions } = cutToFitQuestions({ label: 'Output', kept: 'v2', limits: [limit], dropped: ['the "Agenda" heading'], evidence: [] });
    expect(questions).toHaveLength(1);
    expect(question).not.toContain('\n');
    expect(question).toMatch(/^I have not saved a new version of Output; v2 stays as it is\. The limit /);
  });
});
