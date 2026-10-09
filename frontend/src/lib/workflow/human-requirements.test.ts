import { describe, expect, it } from 'vitest';

import { humanRequirements, unmetHumanRequirements } from './human-requirements';
import { ITEM_SCHEMAS, producibleBy } from './stage-artifact';

const fact = (statement: string, accepted_by: 'user' | 'policy' = 'user') => ({ statement, accepted_by, retired_at: null }) as never;

describe('work only people can do (Q3b; Sean, 9 Oct)', () => {
  it('finds the requirement in the objective\'s own words', () => {
    expect(humanRequirements('Code the transcripts with two independent human coders and report inter-rater reliability.')).toEqual(['independent human coders', 'inter-rater reliability']);
    expect(humanRequirements('Compute the period at six amplitudes.')).toEqual([]);
  });

  it('a run that names it needs people, whatever the draft said', () => {
    const row = { id: 'r', run: 'Second coding pass by an independent coder', producible_by: 'PromptMaster — a second AI pass' };
    expect(producibleBy(row, ITEM_SCHEMAS.runs)).toBe('needs_human');
  });

  it('holds the objective back until a human result is on record as the user\'s fact', () => {
    const project = { objective: 'Two independent human coders code all 40 interviews.', constraints: '', facts: [] };
    expect(unmetHumanRequirements(project)).toEqual(['independent human coders']);
    expect(unmetHumanRequirements({ ...project, facts: [fact('Independent human coders completed the coding; kappa 0.81.', 'policy')] })).toHaveLength(1);
    expect(unmetHumanRequirements({ ...project, facts: [fact('Independent human coders completed the coding; kappa 0.81.')] })).toEqual([]);
  });
});
