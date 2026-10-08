import { describe, expect, it } from 'vitest';

import { sentenceUsingFact, stagesUsingFacts, statementsOf } from './fact-dependencies';

describe('which finished work used a fact (L-52)', () => {
  const memo = 'Candidate A is recommended. Candidate B has managed 100 or more employees for 4 years, against 7 for A. Both interviewed well.';

  it('finds the sentence that states the fact\'s figures', () => {
    expect(sentenceUsingFact(memo, 'Candidate B has managed 100 or more employees for 4 years')).toBe(
      'Candidate B has managed 100 or more employees for 4 years, against 7 for A.'
    );
    // A figure alone, without any of the fact's words, is not a use.
    expect(sentenceUsingFact('Section 4 years ago', 'Candidate B has managed 100 or more employees for 4 years')).toBeNull();
    // 14 is not 4.
    expect(sentenceUsingFact('Candidate B led 100 or more employees for 14 years.', 'Candidate B has managed 100 or more employees for 4 years')).toBeNull();
  });

  it('a fact without figures is used when most of its words are', () => {
    expect(sentenceUsingFact('The Leeds plant closes before spring.', 'The Leeds plant closes')).toBe('The Leeds plant closes before spring.');
    expect(sentenceUsingFact('Leeds is a city.', 'The Leeds plant closes')).toBeNull();
  });

  it('reopens only the stages that used the old value, each with the sentence', () => {
    const affected = stagesUsingFacts(['Candidate B has managed 100 or more employees for 4 years'], [
      { stage_id: 'analysis', label: 'Analysis', text: memo },
      { stage_id: 'brief', label: 'Brief', text: 'Choose a COO for the board.' },
    ]);
    expect(affected).toEqual([{ stage_id: 'analysis', reason: expect.stringContaining('"Candidate B has managed 100 or more employees for 4 years, against 7 for A."') }]);
  });

  it('reads the statements back out of the facts text', () => {
    expect(statementsOf('- A has 7 years\n- Requirement: Keep one researcher free')).toEqual(['A has 7 years', 'Keep one researcher free']);
  });

  it('finds a date or a price however the stage wrote it, without the year (8 Oct, TeamNotes)', () => {
    expect(sentenceUsingFact('TeamNotes launches on Nov. 12th for every team.', 'Launch date: November 12, 2026')).toBe('TeamNotes launches on Nov. 12th for every team.');
    expect(sentenceUsingFact('It costs $12.00 per seat each month.', 'Price: $12 per user per month')).toBe('It costs $12.00 per seat each month.');
    expect(sentenceUsingFact('It launches on November 19.', 'Launch date: November 12, 2026')).toBeNull();
  });
});
